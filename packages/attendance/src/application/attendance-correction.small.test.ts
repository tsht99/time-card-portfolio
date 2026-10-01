import assert from "node:assert/strict";
import test from "node:test";
import type { UserRole, UserStatus } from "@repo/users";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
} from "../domain/attendance.ts";
import { AttendanceTimeOverlapError } from "../domain/attendance-overlap.ts";
import { createAttendanceClockService } from "./attendance-clock.ts";
import {
  AttendanceCorrectionCommandRejectedError,
  AttendanceCorrectionForbiddenError,
  AttendanceCorrectionVersionConflictError,
  createAttendanceCorrectionService,
} from "./attendance-correction.ts";
import {
  type AttendanceEventAppendOptions,
  type AttendanceEventStore,
  AttendanceEventVersionConflictError,
  type AttendanceLock,
  type StoredAttendanceEvent,
} from "./attendance-event-store.ts";

class FakeAttendanceEventStore implements AttendanceEventStore {
  readonly events: StoredAttendanceEvent[] = [];
  readonly appendOptions: AttendanceEventAppendOptions[] = [];
  readonly lockHistory: AttendanceLock[] = [];
  private readonly locks = new Map<string, Promise<void>>();
  readAllCallCount = 0;
  readAllHook?: (callCount: number) => Promise<void>;
  appendError?: Error;

  async runExclusive<T>(
    lock: AttendanceLock,
    operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T> {
    this.lockHistory.push(lock);
    const key = JSON.stringify(lock);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {
      throw new Error("Lock release was not initialized.");
    };
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      key,
      previous.then(() => current),
    );
    await previous;
    try {
      return await operation(this);
    } finally {
      release();
    }
  }

  async readAll(): Promise<readonly StoredAttendanceEvent[]> {
    return this.readEvents();
  }
  async readStream(
    attendanceId: string,
  ): Promise<readonly StoredAttendanceEvent[]> {
    return (await this.readEvents()).filter(
      (event) => event.attendanceId === attendanceId,
    );
  }
  async readStreamsByUserId(
    userId: string,
  ): Promise<readonly StoredAttendanceEvent[]> {
    const snapshot = [...this.events];
    const attendanceIds = new Set(
      snapshot
        .filter(
          (event) =>
            event.eventType === "AttendanceClockedIn" &&
            event.payload.userId === userId,
        )
        .map((event) => event.attendanceId),
    );
    return snapshot.filter((event) => attendanceIds.has(event.attendanceId));
  }
  private async readEvents(): Promise<readonly StoredAttendanceEvent[]> {
    const snapshot = [...this.events];
    const callCount = ++this.readAllCallCount;
    await this.readAllHook?.(callCount);
    return snapshot;
  }
  async append(
    events: readonly AttendanceDomainEvent[],
    options: AttendanceEventAppendOptions,
  ): Promise<void> {
    if (this.appendError) throw this.appendError;
    this.appendOptions.push(options);
    for (const event of events) {
      this.events.push({
        ...event,
        eventId: `event-${this.events.length + 1}`,
        performedByUserId: options.performedByUserId,
        createdAt: new Date("2026-08-22T00:00:00.000Z"),
      });
    }
  }
}

const attendanceId = "attendance-1";
const performedByUserId = "admin-1";
const actor = {
  userId: performedByUserId,
  role: "admin" as const,
  status: "active" as const,
};

let expectedVersionForTest = 2;

function setup({
  clockOut = true,
  workPeriod = "day" as "day" | "night",
  clockInAt = new Date("2026-08-22T09:00:00.000Z"),
} = {}) {
  expectedVersionForTest = clockOut ? 2 : 1;
  const store = new FakeAttendanceEventStore();
  const aggregate = AttendanceAggregate.start(attendanceId);
  const clockIn = aggregate.clockIn({
    userId: "user-1",
    attendanceDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
    }).format(clockInAt),
    workPeriod,
    clockInAt,
  });
  store.events.push({
    ...clockIn,
    eventId: "event-1",
    performedByUserId: "user-1",
    createdAt: new Date(),
  });
  if (clockOut) {
    const event = aggregate.clockOut({
      clockOutAt: new Date("2026-08-22T17:00:00.000Z"),
    });
    store.events.push({
      ...event,
      eventId: "event-2",
      performedByUserId: "user-1",
      createdAt: new Date(),
    });
  }
  return {
    store,
    service: createAttendanceCorrectionService(store),
  };
}

function change(
  changes: {
    workPeriod?: "day" | "night";
    clockInAt?: string;
    clockOutAt?: string;
  },
  commandActor: { userId: string; role: UserRole; status: UserStatus } = actor,
  expectedVersion = expectedVersionForTest,
) {
  return {
    attendanceId,
    expectedVersion,
    actor: commandActor,
    changes: Object.fromEntries(
      Object.entries(changes).map(([key, value]) =>
        key === "clockInAt" || key === "clockOutAt"
          ? [key, new Date(value)]
          : [key, value],
      ),
    ),
  };
}

test("active staffは自分自身を含むAttendanceを訂正できず、Eventをappendしない", async () => {
  for (const commandActor of [
    { userId: "user-1", role: "staff" as const, status: "active" as const },
    { userId: "user-2", role: "staff" as const, status: "active" as const },
  ]) {
    const { service, store } = setup();
    await assert.rejects(
      service.execute(
        change({ clockInAt: "2026-08-22T08:00:00.000Z" }, commandActor),
      ),
      AttendanceCorrectionForbiddenError,
    );
    assert.equal(store.appendOptions.length, 0);
  }
});

test("adminは過去勤怠のclockInAt日付を訂正できる", async () => {
  const { service, store } = setup({
    clockInAt: new Date("2026-08-20T09:00:00.000Z"),
  });
  await service.execute(
    change(
      { clockInAt: "2026-08-19T09:00:00.000Z" },
      {
        userId: "admin-1",
        role: "admin",
        status: "active",
      },
    ),
  );
  assert.equal(store.events.at(-1)?.eventType, "ClockInTimeCorrected");
});

test("inactive staffとinactive adminはAttendanceを訂正できない", async () => {
  for (const commandActor of [
    { userId: "user-1", role: "staff" as const, status: "inactive" as const },
    { userId: "admin-1", role: "admin" as const, status: "inactive" as const },
  ]) {
    const { service, store } = setup();
    await assert.rejects(
      service.execute(
        change({ clockInAt: "2026-08-22T08:00:00.000Z" }, commandActor),
      ),
      AttendanceCorrectionForbiddenError,
    );
    assert.equal(store.appendOptions.length, 0);
  }
});

function addAttendance(
  store: FakeAttendanceEventStore,
  {
    id,
    userId = "user-1",
    attendanceDate = "2026-08-22",
    workPeriod = "day" as const,
    clockInAt = new Date(`${attendanceDate}T09:00:00.000Z`),
    clockOutAt,
  }: {
    id: string;
    userId?: string;
    attendanceDate?: string;
    workPeriod?: "day" | "night";
    clockInAt?: Date;
    clockOutAt?: Date;
  },
) {
  const aggregate = AttendanceAggregate.start(id);
  const event = aggregate.clockIn({
    userId,
    attendanceDate,
    workPeriod,
    clockInAt,
  });
  const events: AttendanceDomainEvent[] = [event];
  if (clockOutAt) events.push(aggregate.clockOut({ clockOutAt }));
  store.events.push(
    ...events.map((attendanceEvent) => ({
      ...attendanceEvent,
      eventId: `event-${store.events.length + 1}`,
      performedByUserId: userId,
      createdAt: new Date(),
    })),
  );
}

function addCancelledAttendance(
  store: FakeAttendanceEventStore,
  options: {
    id: string;
    userId?: string;
    attendanceDate?: string;
    workPeriod?: "day" | "night";
    clockInAt?: Date;
  },
) {
  const aggregate = AttendanceAggregate.start(options.id);
  const clockIn = aggregate.clockIn({
    userId: options.userId ?? "user-1",
    attendanceDate: options.attendanceDate ?? "2026-08-22",
    workPeriod: options.workPeriod ?? "day",
    clockInAt:
      options.clockInAt ??
      new Date(`${options.attendanceDate ?? "2026-08-22"}T09:00:00.000Z`),
  });
  const cancelled = aggregate.cancel();
  store.events.push(
    {
      ...clockIn,
      eventId: `event-${store.events.length + 1}`,
      performedByUserId: "user-1",
      createdAt: new Date(),
    },
    {
      ...cancelled,
      eventId: `event-${store.events.length + 1}`,
      performedByUserId: "user-1",
      createdAt: new Date(),
    },
  );
}

test("clockInAtを訂正できる", async () => {
  const { service, store } = setup();
  await service.execute(change({ clockInAt: "2026-08-22T08:00:00.000Z" }));

  assert.deepEqual(
    store.events.slice(2).map((event) => event.eventType),
    ["ClockInTimeCorrected"],
  );
  const last = store.events.at(-1);
  assert.equal(last?.eventType, "ClockInTimeCorrected");
  if (last?.eventType === "ClockInTimeCorrected") {
    assert.equal(
      last.payload.clockInAt.toISOString(),
      "2026-08-22T08:00:00.000Z",
    );
  }
});

test("clockInAt訂正でactive Attendanceとの実時間重複を拒否し、appendしない", async () => {
  const { service, store } = setup({
    workPeriod: "day",
    clockInAt: new Date("2026-08-22T09:00:00.000Z"),
  });
  addAttendance(store, {
    id: "attendance-night",
    workPeriod: "night",
    clockInAt: new Date("2026-08-22T11:00:00.000Z"),
    clockOutAt: new Date("2026-08-22T12:00:00.000Z"),
  });
  const eventsBefore = store.events.map((event) => ({ ...event }));

  await assert.rejects(
    service.execute(change({ clockInAt: "2026-08-22T11:30:00.000Z" })),
    AttendanceTimeOverlapError,
  );
  assert.equal(store.appendOptions.length, 0);
  assert.deepEqual(store.events, eventsBefore);
});

test("clockOutAt訂正でactive Attendanceとの実時間重複を拒否し、appendしない", async () => {
  const { service, store } = setup({ workPeriod: "day" });
  addAttendance(store, {
    id: "attendance-night",
    workPeriod: "night",
    clockInAt: new Date("2026-08-22T11:00:00.000Z"),
    clockOutAt: new Date("2026-08-22T12:00:00.000Z"),
  });

  await assert.rejects(
    service.execute(change({ clockOutAt: "2026-08-22T11:30:00.000Z" })),
    AttendanceTimeOverlapError,
  );
  assert.equal(store.appendOptions.length, 0);
  assert.equal(store.events.length, 4);
});

test("clockOutAtが別AttendanceのclockInAtと一致する境界は許可する", async () => {
  const { service, store } = setup({ workPeriod: "day" });
  addAttendance(store, {
    id: "attendance-night",
    workPeriod: "night",
    clockInAt: new Date("2026-08-22T11:00:00.000Z"),
    clockOutAt: new Date("2026-08-22T12:00:00.000Z"),
  });

  await service.execute(change({ clockOutAt: "2026-08-22T11:00:00.000Z" }));
  assert.equal(store.events.at(-1)?.eventType, "ClockOutTimeCorrected");
  assert.equal(store.appendOptions.length, 1);
});

test("clockInAtとclockOutAtの同時訂正は最終区間で判定し、最終的に非重複なら成功する", async () => {
  const { service, store } = setup({ workPeriod: "day" });
  addAttendance(store, {
    id: "attendance-night",
    attendanceDate: "2026-08-23",
    workPeriod: "night",
    clockInAt: new Date("2026-08-22T17:00:00.000Z"),
    clockOutAt: new Date("2026-08-22T18:00:00.000Z"),
  });

  await service.execute(
    change({
      clockInAt: "2026-08-22T18:00:00.000Z",
      clockOutAt: "2026-08-22T19:00:00.000Z",
    }),
  );
  assert.deepEqual(
    store.events.slice(4, 6).map((event) => event.eventType),
    ["ClockOutTimeCorrected", "ClockInTimeCorrected"],
  );
  assert.equal(store.appendOptions.length, 1);
});

test("clockInAtとclockOutAtの同時訂正は最終区間が重複すれば拒否する", async () => {
  const { service, store } = setup({ workPeriod: "day" });
  addAttendance(store, {
    id: "attendance-night",
    workPeriod: "night",
    clockInAt: new Date("2026-08-22T10:00:00.000Z"),
    clockOutAt: new Date("2026-08-22T12:00:00.000Z"),
  });

  await assert.rejects(
    service.execute(
      change({
        clockInAt: "2026-08-22T11:30:00.000Z",
        clockOutAt: "2026-08-22T11:45:00.000Z",
      }),
    ),
    AttendanceTimeOverlapError,
  );
  assert.equal(store.appendOptions.length, 0);
  assert.equal(store.events.length, 4);
});

test("対象Attendance自身の区間とは重複せず時刻訂正できる", async () => {
  const { service, store } = setup({ workPeriod: "day" });

  await service.execute(change({ clockOutAt: "2026-08-22T18:00:00.000Z" }));
  assert.equal(store.events.at(-1)?.eventType, "ClockOutTimeCorrected");
  assert.equal(store.appendOptions.length, 1);
});

test("expectedVersion不一致は専用エラーとなりappendしない", async () => {
  const { service, store } = setup();
  const eventsBefore = store.events.length;
  const appendsBefore = store.appendOptions.length;
  await assert.rejects(
    service.execute(
      change({ clockInAt: "2026-08-22T08:00:00.000Z" }, actor, 1),
    ),
    AttendanceCorrectionVersionConflictError,
  );
  assert.equal(store.events.length, eventsBefore);
  assert.equal(store.appendOptions.length, appendsBefore);
});

test("Event StoreのVersion競合は訂正サービスの専用エラーへ変換される", async () => {
  const { service, store } = setup();
  store.appendError = new AttendanceEventVersionConflictError(
    "Expected attendance stream version 2, but found 3.",
    2,
    3,
  );

  await assert.rejects(
    service.execute(change({ clockInAt: "2026-08-22T08:00:00.000Z" })),
    (error: unknown) =>
      error instanceof AttendanceCorrectionVersionConflictError &&
      error.message === "Expected attendance stream version 2, but found 3.",
  );
  assert.equal(store.events.length, 2);
  assert.equal(store.appendOptions.length, 0);
});

test("clockOutAtを訂正できる", async () => {
  const { service, store } = setup();
  await service.execute(change({ clockOutAt: "2026-08-22T18:00:00.000Z" }));

  assert.deepEqual(
    store.events.slice(2).map((event) => event.eventType),
    ["ClockOutTimeCorrected"],
  );
  const last = store.events.at(-1);
  assert.equal(last?.eventType, "ClockOutTimeCorrected");
  if (last?.eventType === "ClockOutTimeCorrected") {
    assert.equal(
      last.payload.clockOutAt.toISOString(),
      "2026-08-22T18:00:00.000Z",
    );
  }
});

test("勤務中Attendanceへ確認済みclockOutAtを補記するとAttendanceClockedOutになる", async () => {
  const { service, store } = setup({ clockOut: false });
  const result = await service.execute(
    change({ clockOutAt: "2026-08-22T18:00:00.000Z" }),
  );

  assert.equal(result.at(-1)?.eventType, "AttendanceClockedOut");
  const final = AttendanceAggregate.replay(store.events);
  assert.equal(final.clockOutAt?.toISOString(), "2026-08-22T18:00:00.000Z");
  assert.equal(store.events.at(-1)?.eventType, "AttendanceClockedOut");
});

test("Invalid Dateは日時エラーとしてそのまま伝播し、イベントを追加しない", async () => {
  for (const changes of [{ clockInAt: "invalid" }, { clockOutAt: "invalid" }]) {
    const { service, store } = setup();
    const field = "clockInAt" in changes ? "clockInAt" : "clockOutAt";

    await assert.rejects(service.execute(change(changes)), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "InvalidAttendanceDateTimeError");
      assert.equal(error.message, `Attendance ${field} must be a valid Date.`);
      return true;
    });
    assert.equal(store.events.length, 2);
  }
});

test("両方を1コマンドで訂正し、途中状態を壊さない順序でappendする", async () => {
  const { service, store } = setup();
  const result = await service.execute(
    change({
      clockInAt: "2026-08-22T20:00:00.000Z",
      clockOutAt: "2026-08-22T22:00:00.000Z",
    }),
  );

  assert.deepEqual(
    result.map((event) => event.eventType),
    ["ClockOutTimeCorrected", "ClockInTimeCorrected"],
  );
  assert.equal(store.events.length, 4);
  assert.equal(store.appendOptions[0]?.expectedVersion, 2);
  assert.equal(store.appendOptions[0]?.performedByUserId, performedByUserId);
});

test("訂正結果は今回生成したイベントを返す", async () => {
  const { service, store } = setup();
  const result = await service.execute(
    change({ clockInAt: "2026-08-22T10:00:00.000Z" }),
  );
  const final = AttendanceAggregate.replay(store.events);
  assert.equal(final.clockInAt?.toISOString(), "2026-08-22T10:00:00.000Z");
  assert.equal(result.length, 1);
});

test("時刻を前後へ大きく移動できる", async () => {
  const { service, store } = setup();
  await service.execute(
    change({
      clockInAt: "2026-08-21T01:00:00.000Z",
      clockOutAt: "2026-08-21T02:00:00.000Z",
    }),
  );
  const aggregate = AttendanceAggregate.replay(store.events);
  assert.equal(aggregate.clockInAt?.toISOString(), "2026-08-21T01:00:00.000Z");

  await service.execute(
    change(
      {
        clockInAt: "2026-08-23T01:00:00.000Z",
        clockOutAt: "2026-08-23T02:00:00.000Z",
      },
      actor,
      4,
    ),
  );
  assert.equal(store.events.length, 6);
});

test("最終的にclockOutAtがclockInAtより前になる訂正を拒否する", async () => {
  const { service, store } = setup();
  await assert.rejects(
    service.execute(
      change({
        clockInAt: "2026-08-22T18:00:00.000Z",
        clockOutAt: "2026-08-22T17:30:00.000Z",
      }),
    ),
    AttendanceCorrectionCommandRejectedError,
  );
  assert.equal(store.events.length, 2);
});

test("clockOut前のclockOutAt訂正はAttendanceClockedOutで完了する", async () => {
  const working = setup({ clockOut: false });
  const result = await working.service.execute(
    change({ clockOutAt: "2026-08-22T18:00:00.000Z" }),
  );
  assert.deepEqual(
    result.map((event) => event.eventType),
    ["AttendanceClockedOut"],
  );
});

test("存在しないattendanceIdはstream not foundとして拒否する", async () => {
  const missing = new FakeAttendanceEventStore();
  await assert.rejects(
    createAttendanceCorrectionService(missing).execute(
      change({ clockInAt: "2026-08-22T08:00:00.000Z" }),
    ),
    (error: unknown) =>
      error instanceof AttendanceCorrectionCommandRejectedError &&
      error.message === "Attendance event stream was not found.",
  );
});

test("同じ値ではイベントを追加しない", async () => {
  const { service, store } = setup();
  const result = await service.execute(
    change({
      clockInAt: "2026-08-22T09:00:00.000Z",
      clockOutAt: "2026-08-22T17:00:00.000Z",
    }),
  );
  assert.equal(result.length, 0);
  assert.equal(store.events.length, 2);
  assert.equal(store.appendOptions.length, 0);
});

test("workPeriod、clockInAt、clockOutAtを訂正できる", async () => {
  const workPeriod = setup();
  assert.deepEqual(
    (await workPeriod.service.execute(change({ workPeriod: "night" }))).map(
      (event) => event.eventType,
    ),
    ["WorkPeriodCorrected"],
  );
  assert.deepEqual(workPeriod.store.lockHistory, [
    { type: "user", userId: "user-1" },
    { type: "stream", attendanceId },
  ]);

  const both = setup();
  assert.deepEqual(
    (
      await both.service.execute(
        change({
          workPeriod: "night",
          clockInAt: "2026-08-23T10:00:00.000Z",
          clockOutAt: "2026-08-23T18:00:00.000Z",
        }),
      )
    ).map((event) => event.eventType),
    ["WorkPeriodCorrected", "ClockOutTimeCorrected", "ClockInTimeCorrected"],
  );
  assert.equal(both.store.appendOptions[0]?.expectedVersion, 2);
  assert.equal(
    both.store.appendOptions[0]?.performedByUserId,
    performedByUserId,
  );
});

test("同じ勤務キーへの訂正はイベントを生成しない", async () => {
  const { service, store } = setup();
  const events = await service.execute(change({ workPeriod: "day" }));
  assert.equal(events.length, 0);
  assert.equal(store.appendOptions.length, 0);
});

test("clockInAtを別日に訂正するとattendanceDateも変わる", async () => {
  const { service, store } = setup();
  const events = await service.execute(
    change({
      clockInAt: "2026-08-23T09:00:00.000Z",
      clockOutAt: "2026-08-23T17:00:00.000Z",
    }),
  );

  const aggregate = AttendanceAggregate.replay(store.events);
  assert.equal(aggregate.attendanceDate, "2026-08-23");
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["ClockOutTimeCorrected", "ClockInTimeCorrected"],
  );
});

test("訂正はuserからstreamの順にロックを取得する", async () => {
  const { service, store } = setup();
  await service.execute(change({ clockInAt: "2026-08-22T12:00:00.000Z" }));

  assert.deepEqual(store.lockHistory, [
    { type: "user", userId: "user-1" },
    { type: "stream", attendanceId },
  ]);
});

test("初回read後に勤務帯が変わっても訂正とnight通常clock-inは重複しない", async () => {
  const { service: delayedCorrection, store } = setup();
  let releaseInitialRead!: () => void;
  const initialReadStarted = new Promise<void>((resolve) => {
    store.readAllHook = async (callCount) => {
      if (callCount !== 1) return;
      resolve();
      await new Promise<void>((resolveRelease) => {
        releaseInitialRead = resolveRelease;
      });
    };
  });

  // B has already read day. Pause it before it can acquire any lock.
  const clockInCorrection = delayedCorrection.execute(
    change({ clockInAt: "2026-08-23T09:00:00.000Z" }),
  );
  await initialReadStarted;

  // A changes the stream to night while B still holds only its stale snapshot.
  await createAttendanceCorrectionService(store).execute(
    change({ workPeriod: "night" }),
  );

  const normalClockIn = createAttendanceClockService(store, {
    createAttendanceId: () => "night-clocked-in",
  }).execute({
    userId: "user-1",
    performedByUserId,
    workPeriod: "night",
    eventType: "clock_in",
    occurredAt: new Date("2026-08-23T09:00:00.000Z"),
  });
  releaseInitialRead();

  const [correctionResult, clockInResult] = await Promise.allSettled([
    clockInCorrection,
    normalClockIn,
  ]);
  assert.equal(
    [correctionResult, clockInResult].filter(
      (result) => result.status === "fulfilled",
    ).length,
    1,
  );

  const matching = store.events
    .map((event) => event.attendanceId)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) =>
      AttendanceAggregate.replay(
        store.events.filter((event) => event.attendanceId === id),
      ),
    )
    .filter(
      (attendance) =>
        attendance.userId === "user-1" &&
        attendance.workPeriod === "night" &&
        attendance.clockInAt !== null &&
        attendance.clockInAt.toISOString() === "2026-08-23T09:00:00.000Z",
    );
  assert.equal(matching.length, 1);
});

test("変更先勤務キーのAttendanceと実時間が重複すれば訂正を拒否する", async () => {
  const active = setup();
  addAttendance(active.store, {
    id: "attendance-2",
    workPeriod: "night",
    clockInAt: new Date("2026-08-22T12:00:00.000Z"),
    clockOutAt: new Date("2026-08-22T13:00:00.000Z"),
  });
  await assert.rejects(
    active.service.execute(change({ workPeriod: "night" })),
    AttendanceTimeOverlapError,
  );
});

test("同日同区分の別Attendanceと非重複なら訂正できる", async () => {
  const { service, store } = setup({
    workPeriod: "night",
    clockInAt: new Date("2026-08-22T11:00:00.000Z"),
  });
  addAttendance(store, {
    id: "attendance-2",
    workPeriod: "day",
    clockInAt: new Date("2026-08-22T09:00:00.000Z"),
    clockOutAt: new Date("2026-08-22T10:00:00.000Z"),
  });

  const result = await service.execute(change({ workPeriod: "day" }));

  assert.deepEqual(
    result.map((event) => event.eventType),
    ["WorkPeriodCorrected"],
  );
  assert.equal(store.appendOptions.length, 1);
});

test("変更先勤務キーにAttendanceCancelled済みAttendanceしかなければ訂正できる", async () => {
  const { service, store } = setup();
  addCancelledAttendance(store, {
    id: "cancelled-attendance",
    attendanceDate: "2026-08-23",
    workPeriod: "night",
  });

  const events = await service.execute(change({ workPeriod: "night" }));

  assert.deepEqual(
    events.map((event) => event.eventType),
    ["WorkPeriodCorrected"],
  );
});

test("勤務キーはstaff、日付、勤務区分ごとに分離され、対象自身は重複とみなさない", async () => {
  const { service, store } = setup();
  addAttendance(store, {
    id: "night",
    workPeriod: "night",
    attendanceDate: "2026-08-23",
    clockInAt: new Date("2026-08-23T09:00:00.000Z"),
  });
  addAttendance(store, { id: "tomorrow", attendanceDate: "2026-08-24" });
  addAttendance(store, { id: "other-user", userId: "user-2" });

  await service.execute(
    change({
      workPeriod: "night",
      clockInAt: "2026-08-24T09:00:00.000Z",
      clockOutAt: "2026-08-24T17:00:00.000Z",
    }),
  );
  assert.equal(store.events.at(-1)?.eventType, "ClockInTimeCorrected");

  const sameTarget = setup();
  await sameTarget.service.execute(
    change({ clockInAt: "2026-08-22T09:00:00.000Z" }),
  );
  assert.equal(sameTarget.store.appendOptions.length, 0);
});

test("勤務キーと時刻を同時訂正しても1回だけappendする", async () => {
  const { service, store } = setup();
  const result = await service.execute(
    change({
      workPeriod: "night",
      clockInAt: "2026-08-23T10:00:00.000Z",
      clockOutAt: "2026-08-23T18:00:00.000Z",
    }),
  );
  assert.deepEqual(
    result.map((event) => event.eventType),
    ["WorkPeriodCorrected", "ClockOutTimeCorrected", "ClockInTimeCorrected"],
  );
  assert.equal(store.appendOptions.length, 1);
});

test("同時訂正と通常clock-inはworking Attendanceがあれば一方だけ成功する", async () => {
  const correction = setup();
  addAttendance(correction.store, {
    id: "attendance-2",
    attendanceDate: "2026-08-24",
    clockInAt: new Date("2026-08-24T09:00:00.000Z"),
  });
  const second = createAttendanceCorrectionService(correction.store);
  const [firstResult, secondResult] = await Promise.allSettled([
    correction.service.execute(
      change({ clockInAt: "2026-08-25T09:00:00.000Z" }),
    ),
    second.execute({
      ...change({ clockInAt: "2026-08-25T09:00:00.000Z" }, actor, 1),
      attendanceId: "attendance-2",
    }),
  ]);
  assert.equal(
    [firstResult, secondResult].filter(
      (result) => result.status === "fulfilled",
    ).length,
    1,
  );

  const clockConflict = setup({ clockOut: false });
  const clock = createAttendanceClockService(clockConflict.store, {
    createAttendanceId: () => "clocked-in",
  });
  const [correctionResult, clockResult] = await Promise.allSettled([
    clockConflict.service.execute(
      change({ clockInAt: "2026-08-23T09:00:00.000Z" }),
    ),
    clock.execute({
      userId: "user-1",
      performedByUserId,
      workPeriod: "day",
      eventType: "clock_in",
      occurredAt: new Date("2026-08-23T09:00:00.000Z"),
    }),
  ]);
  assert.equal(
    [correctionResult, clockResult].filter(
      (result) => result.status === "fulfilled",
    ).length,
    1,
  );
  const active = clockConflict.store.events
    .map((event) => event.attendanceId)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) =>
      AttendanceAggregate.replay(
        clockConflict.store.events.filter((event) => event.attendanceId === id),
      ),
    )
    .filter(
      (attendance) =>
        attendance.userId === "user-1" &&
        attendance.clockInAt !== null &&
        attendance.clockInAt.toISOString() === "2026-08-23T09:00:00.000Z" &&
        attendance.workPeriod === "day",
    );
  assert.equal(active.length, 1);
});

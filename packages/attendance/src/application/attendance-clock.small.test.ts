import assert from "node:assert/strict";
import test from "node:test";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
  type WorkPeriod,
} from "../domain/attendance.ts";
import { AttendanceTimeOverlapError } from "../domain/attendance-overlap.ts";
import {
  AttendanceClockAlreadyWorkingError,
  AttendanceClockCommandRejectedError,
  AttendanceClockNotWorkingError,
  AttendanceClockStaleError,
  createAttendanceClockService,
} from "./attendance-clock.ts";
import type {
  AttendanceEventAppendOptions,
  AttendanceEventStore,
  AttendanceLock,
  StoredAttendanceEvent,
} from "./attendance-event-store.ts";

class FakeAttendanceEventStore implements AttendanceEventStore {
  readonly events: StoredAttendanceEvent[] = [];
  readonly appendOptions: AttendanceEventAppendOptions[] = [];
  readonly lockHistory: AttendanceLock[] = [];
  private readonly locks = new Map<string, Promise<void>>();

  async runExclusive<T>(
    lock: AttendanceLock,
    operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T> {
    this.lockHistory.push(lock);
    const key = JSON.stringify(lock);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
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
    return this.events;
  }
  async readStream(
    attendanceId: string,
  ): Promise<readonly StoredAttendanceEvent[]> {
    return this.events
      .filter((event) => event.attendanceId === attendanceId)
      .sort((a, b) => a.eventVersion - b.eventVersion);
  }
  async readStreamsByUserId(userId: string) {
    const attendanceIds = new Set(
      this.events
        .filter(
          (event) =>
            event.eventType === "AttendanceClockedIn" &&
            event.payload.userId === userId,
        )
        .map((event) => event.attendanceId),
    );
    return this.events
      .filter((event) => attendanceIds.has(event.attendanceId))
      .sort(
        (a, b) =>
          a.attendanceId.localeCompare(b.attendanceId) ||
          a.eventVersion - b.eventVersion,
      );
  }

  async append(
    events: readonly AttendanceDomainEvent[],
    options: AttendanceEventAppendOptions,
  ): Promise<void> {
    if (events.length === 0) return;
    this.appendOptions.push(options);
    await this.runExclusive(
      { type: "stream", attendanceId: events[0].attendanceId },
      async () => {
        for (const event of events)
          this.events.push({
            ...event,
            eventId: `event-${this.events.length + 1}`,
            performedByUserId: options.performedByUserId,
            createdAt: new Date("2026-08-22T00:00:00.000Z"),
          });
      },
    );
  }
}

const userId = "user-1";

function command(
  eventType: "clock_in",
  workPeriod: WorkPeriod,
  occurredAt: string,
): {
  userId: string;
  performedByUserId: string;
  workPeriod: WorkPeriod;
  eventType: "clock_in";
  occurredAt: Date;
};
function command(
  eventType: "clock_out",
  workPeriod: WorkPeriod,
  occurredAt: string,
): {
  userId: string;
  performedByUserId: string;
  workPeriod: WorkPeriod;
  eventType: "clock_out";
  occurredAt: Date;
  targetAttendanceId: string;
  targetEventVersion: number;
};
function command(
  eventType: "clock_out",
  workPeriod: WorkPeriod,
  occurredAt: string,
  targetAttendanceId: string,
  targetEventVersion: number,
): {
  userId: string;
  performedByUserId: string;
  workPeriod: WorkPeriod;
  eventType: "clock_out";
  occurredAt: Date;
  targetAttendanceId: string;
  targetEventVersion: number;
};
function command(
  eventType: "clock_in" | "clock_out",
  workPeriod: WorkPeriod,
  occurredAt: string,
  targetAttendanceId = "attendance-day-1",
  targetEventVersion = 1,
) {
  return {
    userId,
    performedByUserId: userId,
    workPeriod,
    eventType,
    occurredAt: new Date(occurredAt),
    ...(eventType === "clock_out"
      ? { targetAttendanceId, targetEventVersion }
      : {}),
  };
}

function commandWithoutTarget(workPeriod: WorkPeriod, occurredAt: string) {
  return {
    userId,
    performedByUserId: userId,
    workPeriod,
    eventType: "clock_out" as const,
    occurredAt: new Date(occurredAt),
  };
}

function setup() {
  const store = new FakeAttendanceEventStore();
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => "attendance-day-1",
  });
  return { store, service };
}

test("未出勤の昼勤務に出勤できる", async () => {
  const { service, store } = setup();

  const event = await service.execute(
    command("clock_in", "day", "2026-08-22T00:00:00.000Z"),
  );

  assert.equal(event.eventType, "AttendanceClockedIn");
  assert.equal(store.events.length, 1);
});

test("clock-in payloadにworkDateを保存しない", async () => {
  const { service } = setup();

  const event = await service.execute(
    command("clock_in", "day", "2026-08-22T15:00:00.000Z"),
  );

  assert.equal(event.eventType, "AttendanceClockedIn");
  if (event.eventType !== "AttendanceClockedIn") return;
  assert.equal("workDate" in event.payload, false);
});

test("勤務中Attendanceがある間は同日同区分でも再出勤できない", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));

  await assert.rejects(
    service.execute(command("clock_in", "day", "2026-08-22T01:00:00.000Z")),
    AttendanceClockAlreadyWorkingError,
  );
  assert.equal(store.events.length, 1);
  assert.equal(store.appendOptions.length, 1);
});

test("退勤済みなら同日同区分でも別attendanceIdで再出勤できる", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-day-${++nextId}`,
  });
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T09:00:00.000Z"),
  );

  const event = await service.execute(
    command("clock_in", "day", "2026-08-22T10:00:00.000Z"),
  );

  assert.equal(event.attendanceId, "attendance-day-2");
  assert.deepEqual(
    store.events.map((stored) => stored.attendanceId),
    ["attendance-day-1", "attendance-day-1", "attendance-day-2"],
  );
});

test("確定済み勤怠の勤務中に出勤するとイベントを追加しない", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });
  await service.execute(command("clock_in", "day", "2026-08-22T23:49:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T23:59:00.000Z", "attendance-1", 1),
  );

  await assert.rejects(
    service.execute(command("clock_in", "day", "2026-08-22T23:50:00.000Z")),
    AttendanceTimeOverlapError,
  );
  assert.equal(store.events.length, 2);
});

test("出勤は既存勤怠の23:49を拒否し、23:59と23:48を許可する", async () => {
  for (const [clockInAt, expected] of [
    ["2026-08-22T23:49:00.000Z", false],
    ["2026-08-22T23:59:00.000Z", true],
    ["2026-08-22T23:48:00.000Z", true],
  ] as const) {
    const store = new FakeAttendanceEventStore();
    let nextId = 0;
    const service = createAttendanceClockService(store, {
      createAttendanceId: () => `attendance-${++nextId}`,
    });
    await service.execute(
      command("clock_in", "day", "2026-08-22T23:49:00.000Z"),
    );
    await service.execute(
      command(
        "clock_out",
        "day",
        "2026-08-22T23:59:00.000Z",
        "attendance-1",
        1,
      ),
    );

    if (expected) {
      await assert.doesNotReject(
        service.execute(command("clock_in", "day", clockInAt)),
      );
    } else {
      await assert.rejects(
        service.execute(command("clock_in", "day", clockInAt)),
        AttendanceTimeOverlapError,
      );
    }
  }
});

test("非重複勤務は許可し、後続退勤の重複は従来どおり拒否する", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });
  await service.execute(command("clock_in", "day", "2026-08-22T23:49:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T23:59:00.000Z", "attendance-1", 1),
  );
  await service.execute(command("clock_in", "day", "2026-08-22T23:48:00.000Z"));

  await assert.rejects(
    service.execute(
      command(
        "clock_out",
        "day",
        "2026-08-22T23:50:00.000Z",
        "attendance-2",
        1,
      ),
    ),
    AttendanceTimeOverlapError,
  );
  assert.equal(store.events.length, 3);
});

test("勤務日や昼夜区分が異なっても実時間が重複すれば出勤を拒否する", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });
  await service.execute(
    command("clock_in", "night", "2026-08-22T23:49:00.000Z"),
  );
  await service.execute(
    command(
      "clock_out",
      "night",
      "2026-08-23T00:10:00.000Z",
      "attendance-1",
      1,
    ),
  );

  await assert.rejects(
    service.execute(command("clock_in", "day", "2026-08-23T00:00:00.000Z")),
    AttendanceTimeOverlapError,
  );
  assert.equal(store.events.length, 2);
});

test("AttendanceCancelled済みの勤務キーへ新しいattendanceIdで再出勤できる", async () => {
  const store = new FakeAttendanceEventStore();
  const cancelled = AttendanceAggregate.start("cancelled-attendance");
  const clockIn = cancelled.clockIn({
    userId,
    attendanceDate: "2026-08-22",
    workPeriod: "day",
    clockInAt: new Date("2026-08-22T00:00:00.000Z"),
  });
  const cancelledEvent = cancelled.cancel();
  store.events.push(
    {
      ...clockIn,
      eventId: "event-1",
      performedByUserId: userId,
      createdAt: new Date(),
    },
    {
      ...cancelledEvent,
      eventId: "event-2",
      performedByUserId: userId,
      createdAt: new Date(),
    },
  );
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `new-attendance-${++nextId}`,
  });

  const event = await service.execute(
    command("clock_in", "day", "2026-08-22T01:00:00.000Z"),
  );

  assert.equal(event.attendanceId, "new-attendance-1");
  assert.equal(store.events.length, 3);
});

test("勤務中の昼勤務を退勤できる", async () => {
  const { service } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));

  const event = await service.execute(
    command("clock_out", "day", "2026-08-22T09:00:00.000Z"),
  );

  assert.equal(event.eventType, "AttendanceClockedOut");
  assert.equal(event.attendanceId, "attendance-day-1");
});

test("日跨ぎ・月跨ぎ・年跨ぎでも勤務中Attendanceを退勤できる", async () => {
  for (const [clockInAt, clockOutAt] of [
    ["2026-08-24T13:00:00.000Z", "2026-08-25T17:00:00.000Z"],
    ["2026-01-31T13:00:00.000Z", "2026-02-01T17:00:00.000Z"],
    ["2026-12-31T13:00:00.000Z", "2027-01-01T17:00:00.000Z"],
  ]) {
    const { service } = setup();
    await service.execute(command("clock_in", "night", clockInAt));
    const event = await service.execute(
      command("clock_out", "night", clockOutAt),
    );
    assert.equal(event.eventType, "AttendanceClockedOut");
  }
});

test("前日の勤務中Attendanceがあれば翌日の同じ勤務帯へ出勤できない", async () => {
  const { service } = setup();
  await service.execute(
    command("clock_in", "night", "2026-08-24T13:00:00.000Z"),
  );

  await assert.rejects(
    service.execute(command("clock_in", "night", "2026-08-25T00:00:00.000Z")),
    AttendanceClockCommandRejectedError,
  );
});

test("出勤時刻より前の退勤はDomain errorをコマンド拒否へ変換し、イベントを追加しない", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T09:00:00.000Z"));

  await assert.rejects(
    service.execute(command("clock_out", "day", "2026-08-22T08:59:00.000Z")),
    AttendanceClockCommandRejectedError,
  );
  assert.equal(store.events.length, 1);
});

test("退勤済みの昼勤務へ追加打刻できない", async () => {
  const { service } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T09:00:00.000Z"),
  );

  await assert.rejects(
    service.execute(command("clock_out", "day", "2026-08-22T10:00:00.000Z")),
    AttendanceClockStaleError,
  );
});

test("未出勤状態で退勤できない", async () => {
  const { service, store } = setup();

  await assert.rejects(
    service.execute(commandWithoutTarget("day", "2026-08-22T09:00:00.000Z")),
    AttendanceClockNotWorkingError,
  );
  assert.equal(store.events.length, 0);
  assert.equal(store.appendOptions.length, 0);
});

test("targetなし退勤は勤務中Attendanceがあっても自動退勤せずstaleになる", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));

  await assert.rejects(
    service.execute(commandWithoutTarget("day", "2026-08-22T09:00:00.000Z")),
    AttendanceClockStaleError,
  );
  assert.equal(store.events.length, 1);
});

test("AttendanceCancelled済みworking Attendanceはclock-out対象にならない", async () => {
  const store = new FakeAttendanceEventStore();
  const cancelled = AttendanceAggregate.start("cancelled-attendance");
  const clockIn = cancelled.clockIn({
    userId,
    workPeriod: "day",
    attendanceDate: "2026-08-22",
    clockInAt: new Date("2026-08-22T00:00:00.000Z"),
  });
  const cancelledEvent = cancelled.cancel();
  store.events.push(
    {
      ...clockIn,
      eventId: "event-1",
      performedByUserId: userId,
      createdAt: new Date(),
    },
    {
      ...cancelledEvent,
      eventId: "event-2",
      performedByUserId: userId,
      createdAt: new Date(),
    },
  );
  const service = createAttendanceClockService(store);

  await assert.rejects(
    service.execute(command("clock_out", "day", "2026-08-22T09:00:00.000Z")),
    AttendanceClockStaleError,
  );
  assert.equal(store.events.length, 2);
});

test("取消済みAttendanceと新しい有効Attendanceがあれば指定したAttendanceをclock-outする", async () => {
  const store = new FakeAttendanceEventStore();
  const cancelled = AttendanceAggregate.start("cancelled-attendance");
  const firstClockIn = cancelled.clockIn({
    userId,
    workPeriod: "day",
    attendanceDate: "2026-08-22",
    clockInAt: new Date("2026-08-22T00:00:00.000Z"),
  });
  const cancelledEvent = cancelled.cancel();
  store.events.push(
    {
      ...firstClockIn,
      eventId: "event-1",
      performedByUserId: userId,
      createdAt: new Date(),
    },
    {
      ...cancelledEvent,
      eventId: "event-2",
      performedByUserId: userId,
      createdAt: new Date(),
    },
  );
  const active = AttendanceAggregate.start("active-attendance");
  const secondClockIn = active.clockIn({
    userId,
    workPeriod: "day",
    attendanceDate: "2026-08-22",
    clockInAt: new Date("2026-08-22T01:00:00.000Z"),
  });
  store.events.push({
    ...secondClockIn,
    eventId: "event-3",
    performedByUserId: userId,
    createdAt: new Date(),
  });
  const service = createAttendanceClockService(store);

  const event = await service.execute(
    command(
      "clock_out",
      "day",
      "2026-08-22T09:00:00.000Z",
      "active-attendance",
      1,
    ),
  );

  assert.equal(event.attendanceId, "active-attendance");
});

test("表示中の古いAttendanceが終了して新しいAttendanceが開始された場合、古いclock-outをstaleで拒否する", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });

  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T09:00:00.000Z", "attendance-1", 1),
  );
  await service.execute(command("clock_in", "day", "2026-08-22T10:00:00.000Z"));

  await assert.rejects(
    service.execute(
      command(
        "clock_out",
        "day",
        "2026-08-22T18:00:00.000Z",
        "attendance-1",
        1,
      ),
    ),
    AttendanceClockStaleError,
  );
  assert.deepEqual(
    store.events.map(({ attendanceId, eventType }) => ({
      attendanceId,
      eventType,
    })),
    [
      { attendanceId: "attendance-1", eventType: "AttendanceClockedIn" },
      { attendanceId: "attendance-1", eventType: "AttendanceClockedOut" },
      { attendanceId: "attendance-2", eventType: "AttendanceClockedIn" },
    ],
  );
});

test("target versionが一致しないclock-outをstaleで拒否する", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));

  await assert.rejects(
    service.execute(
      command(
        "clock_out",
        "day",
        "2026-08-22T09:00:00.000Z",
        "attendance-day-1",
        2,
      ),
    ),
    AttendanceClockStaleError,
  );
  assert.equal(store.events.length, 1);
});

test("勤務中の昼勤務があると夜勤務の出勤を拒否する", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  await assert.rejects(
    service.execute(command("clock_in", "night", "2026-08-22T10:00:00.000Z")),
    AttendanceClockCommandRejectedError,
  );
});

test("勤務中の夜勤務があると昼勤務の出勤を拒否する", async () => {
  const { service } = setup();
  await service.execute(
    command("clock_in", "night", "2026-08-22T10:00:00.000Z"),
  );
  await assert.rejects(
    service.execute(command("clock_in", "day", "2026-08-22T11:00:00.000Z")),
    AttendanceClockCommandRejectedError,
  );
});

test("同時day/night clock-inは片方だけ成功する", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });
  const results = await Promise.allSettled([
    service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z")),
    service.execute(command("clock_in", "night", "2026-08-22T10:00:00.000Z")),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
});

test("clock-inはuser lockだけでロックする", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  assert.deepEqual(store.lockHistory, [
    { type: "user", userId: "user-1" },
    { type: "stream", attendanceId: "attendance-day-1" },
  ]);
});

test("known clock-outと別period clock-inの同時実行後もpendingは最大1件", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  const results = await Promise.allSettled([
    service.execute(
      command(
        "clock_out",
        "day",
        "2026-08-22T09:00:00.000Z",
        "attendance-1",
        1,
      ),
    ),
    service.execute(command("clock_in", "night", "2026-08-22T10:00:00.000Z")),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    2,
  );
  const streams = new Map<string, StoredAttendanceEvent[]>();
  for (const event of store.events) {
    const stream = streams.get(event.attendanceId) ?? [];
    stream.push(event);
    streams.set(event.attendanceId, stream);
  }
  const pending = [...streams.values()]
    .map((events) => AttendanceAggregate.replay(events))
    .filter(
      (aggregate) => !aggregate.isCancelled && aggregate.clockOutAt === null,
    );
  assert.equal(pending.length, 1);
  assert.equal(store.events.at(-1)?.eventType, "AttendanceClockedIn");
});

test("appendされるイベントのattendanceIdとversionが正しい", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T09:00:00.000Z"),
  );

  assert.deepEqual(
    store.events.map(({ attendanceId, eventVersion }) => ({
      attendanceId,
      eventVersion,
    })),
    [
      { attendanceId: "attendance-day-1", eventVersion: 1 },
      { attendanceId: "attendance-day-1", eventVersion: 2 },
    ],
  );
});

test("clock_inとclock_outは現在のstream versionをexpectedVersionとして渡す", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T09:00:00.000Z"),
  );

  assert.deepEqual(
    store.appendOptions.map(({ expectedVersion }) => expectedVersion),
    [0, 1],
  );
});

test("clock_inとclock_outは操作者をStored Eventメタデータに保存する", async () => {
  const { service, store } = setup();
  await service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z"));
  await service.execute(
    command("clock_out", "day", "2026-08-22T09:00:00.000Z"),
  );

  assert.deepEqual(
    store.events.map(({ eventId, performedByUserId }) => ({
      eventId,
      performedByUserId,
    })),
    [
      { eventId: "event-1", performedByUserId: userId },
      { eventId: "event-2", performedByUserId: userId },
    ],
  );
  const readEvents = await store.readAll();
  assert.equal(readEvents[0]?.eventId, "event-1");
  assert.equal(readEvents[1]?.performedByUserId, userId);
});

test("同じ勤務への同時clock_inは片方だけ成功する", async () => {
  const store = new FakeAttendanceEventStore();
  let nextId = 0;
  const service = createAttendanceClockService(store, {
    createAttendanceId: () => `attendance-${++nextId}`,
  });

  const results = await Promise.allSettled([
    service.execute(command("clock_in", "day", "2026-08-22T00:00:00.000Z")),
    service.execute(command("clock_in", "day", "2026-08-22T00:01:00.000Z")),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof AttendanceClockCommandRejectedError,
    ).length,
    1,
  );
  assert.equal(store.events.length, 1);
});

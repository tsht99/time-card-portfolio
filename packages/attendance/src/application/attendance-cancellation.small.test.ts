import assert from "node:assert/strict";
import test from "node:test";
import type { UserRole, UserStatus } from "@repo/users";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
} from "../domain/attendance.ts";
import {
  AttendanceCancellationCommandRejectedError,
  AttendanceCancellationForbiddenError,
  AttendanceCancellationVersionConflictError,
  createAttendanceCancellationService,
} from "./attendance-cancellation.ts";
import {
  type AttendanceEventAppendOptions,
  type AttendanceEventStore,
  AttendanceEventVersionConflictError,
  type AttendanceLock,
  type StoredAttendanceEvent,
} from "./attendance-event-store.ts";

class FakeStore implements AttendanceEventStore {
  appendError: Error | null = null;
  readonly events: StoredAttendanceEvent[] = [];
  readonly appendOptions: AttendanceEventAppendOptions[] = [];
  private readonly locks = new Map<string, Promise<void>>();

  async runExclusive<T>(
    lock: AttendanceLock,
    operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T> {
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
    return this.events.filter((event) => attendanceIds.has(event.attendanceId));
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
        createdAt: new Date(),
      });
    }
  }
}

function setup({
  clockOut = false,
  clockInAt = new Date("2026-08-22T09:00:00Z"),
  clockOutAt = new Date("2026-08-22T18:00:00Z"),
} = {}) {
  const store = new FakeStore();
  const aggregate = AttendanceAggregate.start("attendance-1");
  const clockIn = aggregate.clockIn({
    userId: "staff-1",
    attendanceDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
    }).format(clockInAt),
    workPeriod: "day",
    clockInAt,
  });
  store.events.push({
    ...clockIn,
    eventId: "event-1",
    performedByUserId: "staff-1",
    createdAt: new Date(),
  });
  if (clockOut) {
    const event = aggregate.clockOut({
      clockOutAt,
    });
    store.events.push({
      ...event,
      eventId: "event-2",
      performedByUserId: "staff-1",
      createdAt: new Date(),
    });
  }
  return {
    store,
    service: createAttendanceCancellationService(store),
  };
}

const command = (
  actor: { userId: string; role: UserRole; status: UserStatus } = {
    userId: "admin-1",
    role: "admin",
    status: "active",
  },
  attendanceId = "attendance-1",
  expectedVersion = 1,
) => ({
  attendanceId,
  actor,
  expectedVersion,
});

test("stale expectedVersionは競合として拒否しイベントを追加しない", async () => {
  const { store, service } = setup();
  await assert.rejects(
    service.execute({ ...command(), expectedVersion: 2 }),
    AttendanceCancellationVersionConflictError,
  );
  assert.equal(store.events.length, 1);
  assert.equal(store.appendOptions.length, 0);
});

test("append時のversion競合も取消専用Conflictへ変換する", async () => {
  const { store, service } = setup();
  store.appendError = new AttendanceEventVersionConflictError("stale");
  await assert.rejects(
    service.execute(command()),
    AttendanceCancellationVersionConflictError,
  );
  assert.equal(store.events.length, 1);
  assert.equal(store.appendOptions.length, 0);
});

test("active staffは自分のworking/completed Attendanceを取消できない", async () => {
  for (const clockOut of [false, true]) {
    const { store, service } = setup({ clockOut });
    await assert.rejects(
      service.execute(
        command(
          { userId: "staff-1", role: "staff", status: "active" },
          "attendance-1",
          clockOut ? 2 : 1,
        ),
      ),
      AttendanceCancellationForbiddenError,
    );
    assert.equal(store.appendOptions.length, 0);
  }
});

test("取消結果は今回生成したイベントを返しcompleted Attendanceも全体取消する", async () => {
  const { service, store } = setup({ clockOut: true });
  const result = await service.execute(command(undefined, "attendance-1", 2));
  assert.equal(result.eventType, "AttendanceCancelled");
  const final = AttendanceAggregate.replay(store.events);
  assert.equal(final.clockOutAt?.toISOString(), "2026-08-22T18:00:00.000Z");
  assert.equal(final.isCancelled, true);
});

test("active adminは過去日に開始して退勤済みのAttendanceを取消できる", async () => {
  const { service, store } = setup({
    clockOut: true,
    clockInAt: new Date("2026-08-21T09:00:00Z"),
  });
  const event = await service.execute(
    command(
      {
        userId: "admin-1",
        role: "admin",
        status: "active",
      },
      "attendance-1",
      2,
    ),
  );
  assert.equal(event.eventType, "AttendanceCancelled");
  assert.equal(store.appendOptions.length, 1);
});

test("active adminは他staffのAttendanceを取消できる", async () => {
  const { service, store } = setup();
  await service.execute(
    command({ userId: "admin-1", role: "admin", status: "active" }),
  );
  assert.equal(store.events.at(-1)?.eventType, "AttendanceCancelled");
});

test("active staffおよびinactive userはForbiddenでappendしない", async () => {
  for (const actor of [
    { userId: "staff-1", role: "staff" as const, status: "active" as const },
    { userId: "staff-2", role: "staff" as const, status: "active" as const },
    { userId: "staff-1", role: "staff" as const, status: "inactive" as const },
    { userId: "admin-1", role: "admin" as const, status: "inactive" as const },
  ]) {
    const { service, store } = setup();
    await assert.rejects(
      service.execute(command(actor)),
      AttendanceCancellationForbiddenError,
    );
    assert.equal(store.appendOptions.length, 0);
  }
});

test("inactive userはAttendanceの存在有無にかかわらずForbiddenでappendしない", async () => {
  for (const actor of [
    { userId: "staff-1", role: "staff" as const, status: "inactive" as const },
    { userId: "admin-1", role: "admin" as const, status: "inactive" as const },
  ]) {
    const store = new FakeStore();
    await assert.rejects(
      createAttendanceCancellationService(store).execute(
        command(actor, "missing-attendance"),
      ),
      AttendanceCancellationForbiddenError,
    );
    assert.equal(store.appendOptions.length, 0);
  }
});

test("active adminのstream不存在と取消済みAttendanceはCommandRejectedでappendしない", async () => {
  const missing = new FakeStore();
  await assert.rejects(
    createAttendanceCancellationService(missing).execute(command()),
    AttendanceCancellationCommandRejectedError,
  );
  assert.equal(missing.appendOptions.length, 0);

  const cancelled = setup();
  await cancelled.service.execute(command());
  await assert.rejects(
    cancelled.service.execute(command(undefined, "attendance-1", 2)),
    AttendanceCancellationCommandRejectedError,
  );
  assert.equal(cancelled.store.appendOptions.length, 1);
});

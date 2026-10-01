import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import test from "node:test";
import type { AttendanceDomainEvent } from "../domain/attendance.ts";
import { AttendanceTimeOverlapError } from "../domain/attendance-overlap.ts";
import type {
  AttendanceEventAppendOptions,
  AttendanceEventStore,
  AttendanceLock,
  StoredAttendanceEvent,
} from "./attendance-event-store.ts";
import {
  AttendanceManualCreationCommandRejectedError,
  createAttendanceManualCreationService,
} from "./attendance-manual-creation.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attendanceId = "22222222-2222-4222-8222-222222222222";

function at(time: string): Date {
  return new Date(`2026-08-22T${time}:00.000Z`);
}

function clockIn(
  id: string,
  workPeriod: "day" | "night",
  clockInAt: Date,
): StoredAttendanceEvent {
  return {
    eventId: `${id}-in`,
    attendanceId: id,
    eventVersion: 1,
    eventType: "AttendanceClockedIn",
    performedByUserId: adminId,
    createdAt: at("00:00"),
    payload: {
      userId,
      workPeriod,
      attendanceDate: "2026-08-22",
      clockInAt,
    },
  };
}

function clockOut(id: string, clockOutAt: Date): StoredAttendanceEvent {
  return {
    eventId: `${id}-out`,
    attendanceId: id,
    eventVersion: 2,
    eventType: "AttendanceClockedOut",
    performedByUserId: adminId,
    createdAt: at("00:00"),
    payload: { clockOutAt },
  };
}

class FakeStore implements AttendanceEventStore {
  readonly appended: Array<{
    events: readonly AttendanceDomainEvent[];
    options: AttendanceEventAppendOptions;
  }> = [];

  constructor(readonly events: StoredAttendanceEvent[] = []) {}

  async runExclusive<T>(
    _lock: AttendanceLock,
    operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async readAll() {
    return this.events;
  }

  async readStream(id: string) {
    return this.events.filter((event) => event.attendanceId === id);
  }

  async readStreamsByUserId(id: string) {
    const attendanceIds = new Set(
      this.events.flatMap((event) =>
        event.eventType === "AttendanceClockedIn" && event.payload.userId === id
          ? [event.attendanceId]
          : [],
      ),
    );
    return this.events.filter((event) => attendanceIds.has(event.attendanceId));
  }

  async append(
    events: readonly AttendanceDomainEvent[],
    options: AttendanceEventAppendOptions,
  ) {
    this.appended.push({ events, options });
    this.events.push(
      ...events.map((event, index) => ({
        ...event,
        eventId: `appended-${index}`,
        performedByUserId: options.performedByUserId,
        createdAt: at("00:00"),
      })),
    );
  }
}

function createService(store: FakeStore) {
  return createAttendanceManualCreationService(store, {
    createAttendanceId: () => attendanceId,
  });
}

function command(
  overrides: Partial<{
    workPeriod: "day" | "night";
    clockInAt: Date;
    clockOutAt: Date;
  }> = {},
) {
  return {
    userId,
    performedByUserId: adminId,
    workPeriod: "day" as const,
    clockInAt: at("09:00"),
    clockOutAt: at("18:00"),
    ...overrides,
  };
}

async function assertRejectedWithoutAppend(
  store: FakeStore,
  input = command(),
  errorType:
    | typeof AttendanceManualCreationCommandRejectedError
    | typeof AttendanceTimeOverlapError = AttendanceManualCreationCommandRejectedError,
) {
  const initialEventCount = store.events.length;
  await rejects(createService(store).execute(input), errorType);
  strictEqual(store.appended.length, 0);
  strictEqual(store.events.length, initialEventCount);
}

test("管理者作成は同じstreamの出退勤イベントを一括保存する", async () => {
  const store = new FakeStore();
  const result = await createService(store).execute({
    ...command({
      clockInAt: new Date("2026-08-21T15:30:00.000Z"),
      clockOutAt: new Date("2026-08-22T00:00:00.000Z"),
    }),
  });

  strictEqual(result.attendanceId, attendanceId);
  strictEqual(store.appended.length, 1);
  deepStrictEqual(
    store.appended[0]?.events.map((event) => ({
      attendanceId: event.attendanceId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
    })),
    [
      {
        attendanceId,
        eventType: "AttendanceClockedIn",
        eventVersion: 1,
      },
      {
        attendanceId,
        eventType: "AttendanceClockedOut",
        eventVersion: 2,
      },
    ],
  );
  strictEqual(store.appended[0]?.options.expectedVersion, 0);
  strictEqual(store.appended[0]?.options.performedByUserId, adminId);
  const clockedIn = store.appended[0]?.events[0];
  strictEqual(
    clockedIn?.eventType === "AttendanceClockedIn" &&
      clockedIn.payload.attendanceDate,
    "2026-08-22",
  );
});

test("同日同区分でも完了済み勤務と非重複なら管理者作成できる", async () => {
  const existingId = "existing-completed";
  const store = new FakeStore([
    clockIn(existingId, "day", at("08:00")),
    clockOut(existingId, at("09:00")),
  ]);

  const result = await createService(store).execute(
    command({ clockInAt: at("09:00"), clockOutAt: at("18:00") }),
  );

  strictEqual(result.attendanceId, attendanceId);
  strictEqual(store.appended.length, 1);
});

test("勤怠と時間が重なる管理者作成を拒否する", async () => {
  const existingId = "existing-active";
  const store = new FakeStore([
    clockIn(existingId, "day", at("08:00")),
    clockOut(existingId, at("10:00")),
  ]);

  await assertRejectedWithoutAppend(
    store,
    command({
      workPeriod: "night",
      clockInAt: at("09:00"),
      clockOutAt: at("11:00"),
    }),
    AttendanceTimeOverlapError,
  );
});

test("出退勤順序が不正な管理者作成は保存しない", async () => {
  await assertRejectedWithoutAppend(
    new FakeStore(),
    command({ clockInAt: at("18:00"), clockOutAt: at("09:00") }),
  );
});

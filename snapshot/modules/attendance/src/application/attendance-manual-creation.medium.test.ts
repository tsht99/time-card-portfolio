import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceAggregate } from "../domain/attendance.ts";
import { AttendanceTimeOverlapError } from "../domain/attendance-overlap.ts";
import {
  createPostgresAttendanceEventStore,
  startMediumTestDatabase,
  users,
} from "../test/medium-postgres.ts";
import { createAttendanceManualCreationService } from "./attendance-manual-creation.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const adminAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const adminBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const attendanceAId = "22222222-2222-4222-8222-222222222222";
const attendanceBId = "33333333-3333-4333-8333-333333333333";

test("実PostgreSQL上の競合する管理者新規作成は重複勤怠を残さない", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      {
        id: userId,
        lineUserId: "manual-creation-target",
        displayName: "Manual Creation Target",
      },
      {
        id: adminAId,
        lineUserId: "manual-creation-admin-a",
        displayName: "Manual Creation Admin A",
        role: "admin",
        status: "active",
      },
      {
        id: adminBId,
        lineUserId: "manual-creation-admin-b",
        displayName: "Manual Creation Admin B",
        role: "admin",
        status: "active",
      },
    ]);
    const store = createPostgresAttendanceEventStore(database);
    const createA = createAttendanceManualCreationService(store, {
      createAttendanceId: () => attendanceAId,
    });
    const createB = createAttendanceManualCreationService(store, {
      createAttendanceId: () => attendanceBId,
    });
    const input = {
      userId,
      workPeriod: "day" as const,
      clockInAt: new Date("2026-08-22T00:00:00.000Z"),
      clockOutAt: new Date("2026-08-22T09:00:00.000Z"),
    };

    const results = await Promise.allSettled([
      createA.execute({ ...input, performedByUserId: adminAId }),
      createB.execute({ ...input, performedByUserId: adminBId }),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected);
    assert.ok(rejected.reason instanceof AttendanceTimeOverlapError);

    const events = await store.readStreamsByUserId(userId);
    assert.equal(events.length, 2);
    const attendance = AttendanceAggregate.replay(events);
    assert.equal(attendance.workPeriod, "day");
    assert.equal(attendance.attendanceDate, "2026-08-22");
  } finally {
    await database.close();
  }
});

test("実PostgreSQL上の0分管理者作成は既存完了区間内でも許可し、正の長さの重複は拒否する", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      {
        id: userId,
        lineUserId: "manual-zero-target",
        displayName: "Manual Zero Target",
      },
      {
        id: adminAId,
        lineUserId: "manual-zero-admin",
        displayName: "Manual Zero Admin",
        role: "admin",
        status: "active",
      },
    ]);
    const store = createPostgresAttendanceEventStore(database);
    const existing = AttendanceAggregate.start(attendanceAId);
    const existingEvents = [
      existing.clockIn({
        userId,
        attendanceDate: "2026-08-22",
        workPeriod: "day",
        clockInAt: new Date("2026-08-22T09:00:00.000Z"),
      }),
      existing.clockOut({
        clockOutAt: new Date("2026-08-22T12:00:00.000Z"),
      }),
    ];
    await store.append(existingEvents, {
      expectedVersion: 0,
      performedByUserId: adminAId,
    });

    const createZero = createPostgresAttendanceManualCreationService(
      store,
      attendanceBId,
    );
    const zeroTime = new Date("2026-08-22T10:00:00.000Z");
    const zero = await createZero.execute({
      userId,
      performedByUserId: adminAId,
      workPeriod: "night",
      clockInAt: zeroTime,
      clockOutAt: zeroTime,
    });
    assert.equal(zero.events.length, 2);

    const createOverlap = createPostgresAttendanceManualCreationService(
      store,
      "44444444-4444-4444-8444-444444444444",
    );
    await assert.rejects(
      createOverlap.execute({
        userId,
        performedByUserId: adminAId,
        workPeriod: "day",
        clockInAt: new Date("2026-08-22T10:00:00.000Z"),
        clockOutAt: new Date("2026-08-22T10:30:00.000Z"),
      }),
      AttendanceTimeOverlapError,
    );
  } finally {
    await database.close();
  }
});

function createPostgresAttendanceManualCreationService(
  store: ReturnType<typeof createPostgresAttendanceEventStore>,
  attendanceId: string,
) {
  return createAttendanceManualCreationService(store, {
    createAttendanceId: () => attendanceId,
  });
}

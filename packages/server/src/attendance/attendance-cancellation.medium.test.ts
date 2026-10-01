import assert from "node:assert/strict";
import test from "node:test";
import {
  AttendanceAggregate,
  createAttendanceCancellationService,
  createAttendanceClockService,
} from "@repo/attendance";
import { PostgresAttendanceEventStore } from "@repo/attendance/infrastructure";
import { attendanceCurrentStates, users } from "@repo/db";
import { eq } from "drizzle-orm";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attendanceId = "22222222-2222-4222-8222-222222222222";
const nonConcurrentAttendanceId = "55555555-5555-4555-8555-555555555555";

test("実PostgreSQL上でcompleted Attendanceを全体取消できる", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      {
        id: userId,
        lineUserId: "medium-cancellation-success-target",
        displayName: "Target",
      },
      {
        id: actorId,
        lineUserId: "medium-cancellation-success-admin",
        displayName: "Admin",
        role: "admin",
        status: "active",
      },
    ]);

    const store = new PostgresAttendanceEventStore(database.db);
    const cancellation = createAttendanceCancellationService(store);
    const initial = AttendanceAggregate.start(nonConcurrentAttendanceId);
    await store.append(
      [
        initial.clockIn({
          userId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockInAt: new Date("2026-08-22T09:00:00.000Z"),
        }),
        initial.clockOut({
          clockOutAt: new Date("2026-08-22T18:00:00.000Z"),
        }),
      ],
      { expectedVersion: 0, performedByUserId: actorId },
    );

    const event = await cancellation.execute({
      attendanceId: nonConcurrentAttendanceId,
      expectedVersion: 2,
      actor: {
        userId: actorId,
        role: "admin",
        status: "active",
      },
    });

    assert.equal(event.eventType, "AttendanceCancelled");
    assert.deepEqual(
      await database.db
        .select({ isCancelled: attendanceCurrentStates.isCancelled })
        .from(attendanceCurrentStates)
        .where(
          eq(attendanceCurrentStates.attendanceId, nonConcurrentAttendanceId),
        ),
      [{ isCancelled: true }],
    );
    assert.equal(
      AttendanceAggregate.replay(
        await store.readStream(nonConcurrentAttendanceId),
      ).clockOutAt?.toISOString(),
      "2026-08-22T18:00:00.000Z",
    );
  } finally {
    await database.close();
  }
});

test("実PostgreSQL上でAttendance全体取消と新規clock-inを並行実行できる", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      {
        id: userId,
        lineUserId: "medium-cancellation-target",
        displayName: "Target",
      },
      {
        id: actorId,
        lineUserId: "medium-cancellation-admin",
        displayName: "Admin",
        role: "admin",
        status: "active",
      },
    ]);

    const store = new PostgresAttendanceEventStore(database.db);
    const cancellation = createAttendanceCancellationService(store);
    const clock = createAttendanceClockService(store, {
      createAttendanceId: () => "44444444-4444-4444-8444-444444444444",
    });
    const initial = AttendanceAggregate.start(attendanceId);
    await store.append(
      [
        initial.clockIn({
          userId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockInAt: new Date("2026-08-22T09:00:00.000Z"),
        }),
        initial.clockOut({
          clockOutAt: new Date("2026-08-22T18:00:00.000Z"),
        }),
      ],
      { expectedVersion: 0, performedByUserId: actorId },
    );

    const actor = {
      userId: actorId,
      role: "admin" as const,
      status: "active" as const,
    };

    const [clockIn, cancelled] = await Promise.all([
      clock.execute({
        userId,
        performedByUserId: actorId,
        workPeriod: "night",
        eventType: "clock_in",
        occurredAt: new Date("2026-08-22T19:00:00.000Z"),
      }),
      cancellation.execute({
        attendanceId,
        expectedVersion: 2,
        actor,
      }),
    ]);
    assert.equal(cancelled.eventType, "AttendanceCancelled");
    assert.equal(clockIn.attendanceId, "44444444-4444-4444-8444-444444444444");

    const cancelledAggregate = AttendanceAggregate.replay(
      await store.readStream(attendanceId),
    );
    const activeAggregate = AttendanceAggregate.replay(
      await store.readStream(clockIn.attendanceId),
    );
    assert.equal(cancelledAggregate.isCancelled, true);
    assert.equal(activeAggregate.isCancelled, false);
    assert.equal(activeAggregate.clockOutAt, null);
  } finally {
    await database.close();
  }
});

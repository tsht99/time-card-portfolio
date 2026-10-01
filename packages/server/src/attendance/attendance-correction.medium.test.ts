import assert from "node:assert/strict";
import test from "node:test";
import {
  AttendanceAggregate,
  AttendanceTimeOverlapError,
  createAttendanceCorrectionService,
  findAttendanceTimeOverlap,
  toAttendanceTimeInterval,
} from "@repo/attendance";
import { PostgresAttendanceEventStore } from "@repo/attendance/infrastructure";
import { users } from "@repo/db";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attendanceAId = "22222222-2222-4222-8222-222222222222";
const attendanceBId = "33333333-3333-4333-8333-333333333333";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, description: string) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}.`)),
      5_000,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForTwoWaitingAdvisoryLocks(
  pool: Awaited<ReturnType<typeof startMediumTestDatabase>>["pool"],
) {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const result = await pool.query<{ granted: boolean; count: number }>(`
      SELECT granted, count(*)::int AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
      GROUP BY granted
    `);
    const granted = result.rows.find((row) => row.granted)?.count ?? 0;
    const waiting = result.rows.find((row) => !row.granted)?.count ?? 0;
    if (granted >= 1 && waiting >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "Timed out waiting for both corrections to wait for user lock.",
  );
}

function at(time: string): Date {
  return new Date(`2026-08-22T${time}:00.000Z`);
}

test("実PostgreSQL上で同一ユーザーの異なる勤怠訂正を並行実行しても勤務時間が重複しない", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      {
        id: userId,
        lineUserId: "medium-correction-target",
        displayName: "Medium Correction Target",
      },
      {
        id: actorId,
        lineUserId: "medium-correction-admin",
        displayName: "Medium Correction Admin",
        role: "admin",
        status: "active",
      },
    ]);

    const store = new PostgresAttendanceEventStore(database.db);
    const service = createAttendanceCorrectionService(store);
    const initialA = AttendanceAggregate.start(attendanceAId);
    const initialB = AttendanceAggregate.start(attendanceBId);
    const aEvents = [
      initialA.clockIn({
        userId,
        attendanceDate: "2026-08-22",
        workPeriod: "day",
        clockInAt: at("09:00"),
      }),
      initialA.clockOut({ clockOutAt: at("10:00") }),
    ];
    const bEvents = [
      initialB.clockIn({
        userId,
        attendanceDate: "2026-08-22",
        workPeriod: "night",
        clockInAt: at("11:00"),
      }),
      initialB.clockOut({ clockOutAt: at("12:00") }),
    ];
    await store.append(aEvents, {
      expectedVersion: 0,
      performedByUserId: actorId,
    });
    await store.append(bEvents, {
      expectedVersion: 0,
      performedByUserId: actorId,
    });

    const releaseUserLock = deferred<void>();
    const userLockHeld = deferred<void>();
    let lockHolder: Promise<unknown> | undefined;
    let correctionA: Promise<unknown> | undefined;
    let correctionB: Promise<unknown> | undefined;

    const actor = {
      userId: actorId,
      role: "admin" as const,
      status: "active" as const,
    };

    try {
      lockHolder = store.runExclusive({ type: "user", userId }, async () => {
        userLockHeld.resolve();
        await releaseUserLock.promise;
      });
      await withTimeout(userLockHeld.promise, "the test user lock");

      correctionA = service.execute({
        attendanceId: attendanceAId,
        expectedVersion: 2,
        actor,
        changes: { clockOutAt: at("10:30") },
      });
      correctionB = service.execute({
        attendanceId: attendanceBId,
        expectedVersion: 2,
        actor,
        changes: { clockInAt: at("10:15") },
      });

      await waitForTwoWaitingAdvisoryLocks(database.pool);
      releaseUserLock.resolve();

      const results = await Promise.allSettled([correctionA, correctionB]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        results.filter((result) => result.status === "rejected").length,
        1,
      );
      const rejected = results.find((result) => result.status === "rejected");
      assert.ok(rejected);
      assert.ok(rejected.reason instanceof AttendanceTimeOverlapError);
    } finally {
      releaseUserLock.resolve();
      await Promise.allSettled(
        [correctionA, correctionB].filter(
          (correction): correction is Promise<unknown> =>
            correction !== undefined,
        ),
      );
      if (lockHolder !== undefined) {
        await Promise.allSettled([lockHolder]);
      }
    }

    const [finalEventsA, finalEventsB] = await Promise.all([
      store.readStream(attendanceAId),
      store.readStream(attendanceBId),
    ]);
    const finalA = AttendanceAggregate.replay(finalEventsA);
    const finalB = AttendanceAggregate.replay(finalEventsB);
    const intervalA = toAttendanceTimeInterval(finalA.state);
    const intervalB = toAttendanceTimeInterval(finalB.state);
    assert.ok(intervalA);
    assert.ok(intervalB);
    assert.equal(findAttendanceTimeOverlap(finalA.state, [finalB.state]), null);
    assert.equal(
      [...finalEventsA, ...finalEventsB].filter((event) =>
        event.eventType.endsWith("Corrected"),
      ).length,
      1,
    );
    assert.equal(
      [finalEventsA, finalEventsB].filter((events) =>
        events.some((event) => event.eventType.endsWith("Corrected")),
      ).length,
      1,
    );
  } finally {
    await database.close();
  }
});

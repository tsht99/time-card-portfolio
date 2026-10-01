import assert from "node:assert/strict";
import test from "node:test";
import {
  AttendanceAggregate,
  AttendanceClockAlreadyWorkingError,
  createAttendanceClockService,
} from "@repo/attendance";
import { PostgresAttendanceEventStore } from "@repo/attendance/infrastructure";
import { users } from "@repo/db";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const dayAttendanceId = "22222222-2222-4222-8222-222222222222";
const nightAttendanceId = "33333333-3333-4333-8333-333333333333";

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

async function waitForTwoWaitingOnTheSameUserLock(
  pool: Awaited<ReturnType<typeof startMediumTestDatabase>>["pool"],
) {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    // cspell:ignore classid objid
    const result = await pool.query<{
      first_key_part: number;
      second_key_part: number;
      granted: boolean;
      count: number;
    }>(`
      SELECT classid::int AS first_key_part, objid::int AS second_key_part, granted, count(*)::int AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
      GROUP BY classid, objid, granted
    `);
    const lockKeys = new Map<string, { granted: number; waiting: number }>();
    for (const row of result.rows) {
      const key = `${row.first_key_part}:${row.second_key_part}`;
      const counts = lockKeys.get(key) ?? { granted: 0, waiting: 0 };
      if (row.granted) counts.granted = row.count;
      else counts.waiting = row.count;
      lockKeys.set(key, counts);
    }
    if (
      [...lockKeys.values()].some(
        ({ granted, waiting }) => granted >= 1 && waiting >= 2,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "Timed out waiting for both clock-ins to wait for the same user lock.",
  );
}

test("実PostgreSQL上で同一ユーザーのday/night clock-inはuser lockで直列化される", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values({
      id: userId,
      lineUserId: "medium-clock-target",
      displayName: "Medium Clock Target",
    });

    const store = new PostgresAttendanceEventStore(database.db);
    let nextAttendanceId = 0;
    const attendanceIds = [dayAttendanceId, nightAttendanceId];
    const clock = createAttendanceClockService(store, {
      createAttendanceId: () => {
        const attendanceId = attendanceIds[nextAttendanceId];
        if (attendanceId === undefined) {
          throw new Error("The test exhausted attendance IDs.");
        }
        nextAttendanceId += 1;
        return attendanceId;
      },
    });
    const releaseUserLock = deferred<void>();
    const userLockHeld = deferred<void>();
    let lockHolder: Promise<unknown> | undefined;
    let dayClockIn: Promise<unknown> | undefined;
    let nightClockIn: Promise<unknown> | undefined;

    try {
      lockHolder = store.runExclusive({ type: "user", userId }, async () => {
        userLockHeld.resolve();
        await releaseUserLock.promise;
      });
      await withTimeout(userLockHeld.promise, "the test user lock");

      dayClockIn = clock.execute({
        userId,
        performedByUserId: userId,
        workPeriod: "day",
        eventType: "clock_in",
        occurredAt: new Date("2026-08-22T09:00:00.000Z"),
      });
      nightClockIn = clock.execute({
        userId,
        performedByUserId: userId,
        workPeriod: "night",
        eventType: "clock_in",
        occurredAt: new Date("2026-08-22T19:00:00.000Z"),
      });

      await waitForTwoWaitingOnTheSameUserLock(database.pool);
      releaseUserLock.resolve();

      const results = await Promise.allSettled([dayClockIn, nightClockIn]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const rejected = results.find((result) => result.status === "rejected");
      assert.ok(rejected);
      assert.ok(rejected.reason instanceof AttendanceClockAlreadyWorkingError);
    } finally {
      releaseUserLock.resolve();
      await Promise.allSettled(
        [dayClockIn, nightClockIn].filter(
          (operation): operation is Promise<unknown> => operation !== undefined,
        ),
      );
      if (lockHolder !== undefined) {
        await Promise.allSettled([lockHolder]);
      }
    }

    const finalEvents = await store.readStreamsByUserId(userId);
    assert.equal(
      finalEvents.filter((event) => event.eventType === "AttendanceClockedIn")
        .length,
      1,
    );
    const finalAggregate = AttendanceAggregate.replay(finalEvents);
    assert.equal(finalAggregate.isCancelled, false);
    assert.equal(finalAggregate.clockOutAt, null);
  } finally {
    await database.close();
  }
});

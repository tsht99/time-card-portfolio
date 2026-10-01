import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceAggregate } from "@repo/attendance";
import { PostgresAttendanceEventStore } from "@repo/attendance/infrastructure";
import { attendanceCurrentStates, users } from "@repo/db";
import { eq } from "drizzle-orm";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "11111111-1111-4111-8111-111111111112";
const attendanceId = "22222222-2222-4222-8222-222222222222";
const otherAttendanceId = "33333333-3333-4333-8333-333333333333";
const missingUserId = "44444444-4444-4444-8444-444444444444";
const missingUserAttendanceId = "55555555-5555-4555-8555-555555555555";
const clockInAt = new Date("2026-08-22T09:00:00.000Z");
const clockOutAt = new Date("2026-08-22T18:00:00.000Z");

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function withTimeout<T>(
  promise: Promise<T>,
  description: string,
): Promise<T> {
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

async function waitForAdvisoryLockState(
  pool: Awaited<ReturnType<typeof startMediumTestDatabase>>["pool"],
  predicate: (rows: readonly { granted: boolean; count: number }[]) => boolean,
): Promise<readonly { granted: boolean; count: number }[]> {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const result = await pool.query<{ granted: boolean; count: number }>(`
      SELECT granted, count(*)::int AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
      GROUP BY granted
      ORDER BY granted DESC
    `);
    if (predicate(result.rows)) return result.rows;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the expected advisory lock state.");
}

function advisoryLockCount(
  rows: readonly { granted: boolean; count: number }[],
  granted: boolean,
): number {
  return rows.find((row) => row.granted === granted)?.count ?? 0;
}

async function withMediumDatabase<T>(
  operation: (
    database: Awaited<ReturnType<typeof startMediumTestDatabase>>,
  ) => Promise<T>,
): Promise<T> {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      { id: userId, lineUserId: "event-store-user", displayName: "User" },
      {
        id: otherUserId,
        lineUserId: "event-store-other-user",
        displayName: "Other User",
      },
    ]);
    return await operation(database);
  } finally {
    await database.close();
  }
}

function events(id = attendanceId, eventUserId = userId) {
  const aggregate = AttendanceAggregate.start(id);
  const clockedIn = aggregate.clockIn({
    userId: eventUserId,
    attendanceDate: "2026-08-22",
    workPeriod: "day",
    clockInAt,
  });
  const clockedOut = aggregate.clockOut({ clockOutAt });
  return { clockedIn, clockedOut };
}

async function projection(
  db: Awaited<ReturnType<typeof startMediumTestDatabase>>["db"],
  id: string,
) {
  const [state] = await db
    .select()
    .from(attendanceCurrentStates)
    .where(eq(attendanceCurrentStates.attendanceId, id));
  return state;
}

async function assertProjectionMatchesStream(
  db: Awaited<ReturnType<typeof startMediumTestDatabase>>["db"],
  store: PostgresAttendanceEventStore,
  id: string,
) {
  const aggregate = AttendanceAggregate.replay(await store.readStream(id));
  assert.deepEqual(await projection(db, id), {
    attendanceId: aggregate.attendanceId,
    userId: aggregate.userId,
    attendanceDate: aggregate.attendanceDate,
    workPeriod: aggregate.workPeriod,
    clockInAt: aggregate.clockInAt,
    clockOutAt: aggregate.clockOutAt,
    eventVersion: aggregate.version,
    isCancelled: aggregate.isCancelled,
  });
}

test("実PostgreSQLへappendしたEvent Streamをversion順で読み出す", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const { clockedIn, clockedOut } = events();
    await store.append([clockedIn, clockedOut], {
      expectedVersion: 0,
      performedByUserId: userId,
    });
    assert.deepEqual(
      (await store.readStream(attendanceId)).map(
        ({ attendanceId, eventVersion, eventType, payload }) => ({
          attendanceId,
          eventVersion,
          eventType,
          payload,
        }),
      ),
      [
        {
          attendanceId,
          eventVersion: 1,
          eventType: "AttendanceClockedIn",
          payload: {
            userId,
            attendanceDate: "2026-08-22",
            workPeriod: "day",
            clockInAt,
          },
        },
        {
          attendanceId,
          eventVersion: 2,
          eventType: "AttendanceClockedOut",
          payload: { clockOutAt },
        },
      ],
    );
  });
});

test("appendは同一streamのCurrent State Projectionを更新する", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const { clockedIn, clockedOut } = events();

    await store.append([clockedIn], {
      expectedVersion: 0,
      performedByUserId: userId,
    });
    await assertProjectionMatchesStream(db, store, attendanceId);
    assert.equal((await projection(db, attendanceId))?.eventVersion, 1);
    assert.equal((await projection(db, attendanceId))?.clockOutAt, null);

    await store.append([clockedOut], {
      expectedVersion: 1,
      performedByUserId: userId,
    });
    await assertProjectionMatchesStream(db, store, attendanceId);
    assert.equal((await projection(db, attendanceId))?.eventVersion, 2);
    assert.deepEqual(
      (await projection(db, attendanceId))?.clockOutAt,
      new Date("2026-08-22T18:00:00.000Z"),
    );
  });
});

test("複数Eventを一度にappendすると最終Current State Projectionだけを保存する", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const { clockedIn, clockedOut } = events();

    await store.append([clockedIn, clockedOut], {
      expectedVersion: 0,
      performedByUserId: userId,
    });

    await assertProjectionMatchesStream(db, store, attendanceId);
    assert.equal((await projection(db, attendanceId))?.eventVersion, 2);
  });
});

test("取消済み勤務中Attendanceが残っていても非取消勤務中Attendanceを追加できる", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const cancelledAggregate = AttendanceAggregate.start(attendanceId);
    const cancelledClockIn = cancelledAggregate.clockIn({
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "day",
      clockInAt,
    });
    const cancelled = cancelledAggregate.cancel();
    await store.append([cancelledClockIn, cancelled], {
      expectedVersion: 0,
      performedByUserId: userId,
    });

    assert.deepEqual(await projection(db, attendanceId), {
      attendanceId,
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "day",
      clockInAt,
      clockOutAt: null,
      eventVersion: 2,
      isCancelled: true,
    });

    const activeAggregate = AttendanceAggregate.start(otherAttendanceId);
    const activeClockIn = activeAggregate.clockIn({
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "night",
      clockInAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    await store.append([activeClockIn], {
      expectedVersion: 0,
      performedByUserId: userId,
    });

    assert.deepEqual(await projection(db, otherAttendanceId), {
      attendanceId: otherAttendanceId,
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "night",
      clockInAt: new Date("2026-08-22T12:00:00.000Z"),
      clockOutAt: null,
      eventVersion: 1,
      isCancelled: false,
    });
  });
});

test("非取消勤務中Current Stateはuserごとに1件で完了済みは複数保持できる", async () => {
  await withMediumDatabase(async ({ db }) => {
    const base = {
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "day" as const,
      clockInAt,
    };
    await db.insert(attendanceCurrentStates).values([
      { attendanceId, ...base, clockOutAt, eventVersion: 2 },
      {
        attendanceId: otherAttendanceId,
        ...base,
        clockOutAt,
        eventVersion: 2,
      },
    ]);
    await db.insert(attendanceCurrentStates).values([
      {
        attendanceId: missingUserAttendanceId,
        ...base,
        clockOutAt: null,
        eventVersion: 2,
        isCancelled: true,
      },
      {
        attendanceId: "66666666-6666-4666-8666-666666666666",
        ...base,
        clockOutAt: null,
        eventVersion: 1,
      },
    ]);

    await assert.rejects(
      db.insert(attendanceCurrentStates).values({
        attendanceId: "77777777-7777-4777-8777-777777777777",
        ...base,
        clockOutAt: null,
        eventVersion: 1,
      }),
      (error: unknown) =>
        (error as { cause?: { constraint?: string } }).cause?.constraint ===
        "attendance_current_states_one_working_per_user_idx",
    );
  });
});

test("user lockなしの別stream appendでも2件目勤務中Eventはconstraintでrollbackされる", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const first = AttendanceAggregate.start(attendanceId).clockIn({
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "day",
      clockInAt,
    });
    const rejectedStreamId = "77777777-7777-4777-8777-777777777777";
    const second = AttendanceAggregate.start(rejectedStreamId).clockIn({
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "night",
      clockInAt: new Date("2026-08-22T12:00:00.000Z"),
    });

    await store.append([first], {
      expectedVersion: 0,
      performedByUserId: userId,
    });
    await assert.rejects(
      store.append([second], {
        expectedVersion: 0,
        performedByUserId: userId,
      }),
      (error: unknown) =>
        (error as { cause?: { constraint?: string } }).cause?.constraint ===
        "attendance_current_states_one_working_per_user_idx",
    );

    assert.equal((await store.readStream(attendanceId)).length, 1);
    assert.deepEqual(await store.readStream(rejectedStreamId), []);
    assert.equal((await projection(db, attendanceId))?.isCancelled, false);
    assert.equal(await projection(db, rejectedStreamId), undefined);
  });
});

test("ClockInTimeCorrectedのreplay結果でCurrent State Projectionを更新する", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const aggregate = AttendanceAggregate.start(attendanceId);
    const clockedIn = aggregate.clockIn({
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "day",
      clockInAt,
    });
    const clockedOut = aggregate.clockOut({
      clockOutAt: new Date("2026-08-23T18:00:00.000Z"),
    });
    await store.append([clockedIn, clockedOut], {
      expectedVersion: 0,
      performedByUserId: userId,
    });

    const corrected = aggregate.correctClockInTime({
      clockInAt: new Date("2026-08-23T09:00:00.000Z"),
    });
    await store.append([corrected], {
      expectedVersion: 2,
      performedByUserId: userId,
    });

    await assertProjectionMatchesStream(db, store, attendanceId);
    assert.equal(
      (await projection(db, attendanceId))?.attendanceDate,
      "2026-08-23",
    );
  });
});

test("AttendanceCancelledは履歴を保ちProjectionに取消状態を記録する", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const { clockedIn, clockedOut } = events();
    await store.append([clockedIn, clockedOut], {
      expectedVersion: 0,
      performedByUserId: userId,
    });

    const completed = AttendanceAggregate.replay(
      await store.readStream(attendanceId),
    );
    const cancelled = completed.cancel();
    await store.append([cancelled], {
      expectedVersion: 2,
      performedByUserId: userId,
    });
    assert.equal(
      AttendanceAggregate.replay(
        await store.readStream(attendanceId),
      ).clockOutAt?.toISOString(),
      "2026-08-22T18:00:00.000Z",
    );
    assert.deepEqual(await projection(db, attendanceId), {
      attendanceId,
      userId,
      attendanceDate: "2026-08-22",
      workPeriod: "day",
      clockInAt,
      clockOutAt,
      eventVersion: 3,
      isCancelled: true,
    });
  });
});

test("userId指定readは対象ユーザーのStreamだけを返す", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const target = events();
    const other = events(otherAttendanceId, otherUserId);
    await store.append([target.clockedIn, target.clockedOut], {
      expectedVersion: 0,
      performedByUserId: userId,
    });
    await store.append([other.clockedIn], {
      expectedVersion: 0,
      performedByUserId: otherUserId,
    });
    assert.deepEqual(
      (await store.readStreamsByUserId(userId)).map(
        ({ attendanceId, eventVersion }) => ({ attendanceId, eventVersion }),
      ),
      [
        { attendanceId, eventVersion: 1 },
        { attendanceId, eventVersion: 2 },
      ],
    );
  });
});

test("stale expectedVersionはEventを追加せず競合にする", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const { clockedIn, clockedOut } = events();
    await store.append([clockedIn], {
      expectedVersion: 0,
      performedByUserId: userId,
    });
    const beforeConflict = await projection(db, attendanceId);
    await assert.rejects(
      store.append([clockedOut], {
        expectedVersion: 0,
        performedByUserId: userId,
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "AttendanceEventVersionConflictError",
    );
    assert.equal((await store.readStream(attendanceId)).length, 1);
    assert.deepEqual(await projection(db, attendanceId), beforeConflict);
  });
});

test("Projectionの外部キー制約失敗はEvent appendもrollbackする", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const { clockedIn } = events(missingUserAttendanceId, missingUserId);

    await assert.rejects(
      store.append([clockedIn], {
        expectedVersion: 0,
        performedByUserId: userId,
      }),
    );

    assert.deepEqual(await store.readStream(missingUserAttendanceId), []);
    assert.equal(await projection(db, missingUserAttendanceId), undefined);
  });
});

test("runExclusive内で失敗したappendはtransactionをrollbackする", async () => {
  await withMediumDatabase(async ({ db }) => {
    const store = new PostgresAttendanceEventStore(db);
    const { clockedIn } = events();
    await assert.rejects(
      store.runExclusive({ type: "stream", attendanceId }, async (locked) => {
        await locked.append([clockedIn], {
          expectedVersion: 0,
          performedByUserId: userId,
        });
        throw new Error("rollback");
      }),
    );
    assert.deepEqual(await store.readStream(attendanceId), []);
    assert.equal(await projection(db, attendanceId), undefined);
  });
});

test("実PostgreSQL上で同じstream lockのrunExclusiveを直列化する", async () => {
  await withMediumDatabase(async ({ db, pool }) => {
    const store = new PostgresAttendanceEventStore(db);
    const firstCallbackEntered = deferred<void>();
    const releaseFirstCallback = deferred<void>();
    const secondCallbackEntered = deferred<void>();
    let secondHasEntered = false;
    let firstRun: Promise<void> | undefined;
    let secondRun: Promise<void> | undefined;

    try {
      firstRun = store.runExclusive(
        { type: "stream", attendanceId },
        async () => {
          firstCallbackEntered.resolve();
          await releaseFirstCallback.promise;
        },
      );
      await withTimeout(firstCallbackEntered.promise, "the first callback");
      const firstLockRows = await waitForAdvisoryLockState(
        pool,
        (rows) => advisoryLockCount(rows, true) >= 1,
      );
      assert.ok(advisoryLockCount(firstLockRows, true) >= 1);

      secondRun = store.runExclusive(
        { type: "stream", attendanceId },
        async () => {
          secondHasEntered = true;
          secondCallbackEntered.resolve();
        },
      );
      const waitingLockRows = await waitForAdvisoryLockState(
        pool,
        (rows) => advisoryLockCount(rows, false) >= 1,
      );
      assert.ok(advisoryLockCount(waitingLockRows, true) >= 1);
      assert.ok(advisoryLockCount(waitingLockRows, false) >= 1);
      assert.equal(secondHasEntered, false);

      releaseFirstCallback.resolve();
      await withTimeout(secondCallbackEntered.promise, "the second callback");
      await Promise.all([firstRun, secondRun]);
      assert.equal(secondHasEntered, true);
    } finally {
      releaseFirstCallback.resolve();
      await Promise.allSettled(
        [firstRun, secondRun].filter(
          (run): run is Promise<void> => run !== undefined,
        ),
      );
    }
  });
});

test("実PostgreSQL上でuser lockを取得できる", async () => {
  await withMediumDatabase(async ({ db, pool }) => {
    const store = new PostgresAttendanceEventStore(db);
    const callbackEntered = deferred<void>();
    const releaseCallback = deferred<void>();
    const run = store.runExclusive({ type: "user", userId }, async () => {
      callbackEntered.resolve();
      await releaseCallback.promise;
    });
    try {
      await withTimeout(callbackEntered.promise, "the user callback");
      const lockRows = await waitForAdvisoryLockState(
        pool,
        (rows) => advisoryLockCount(rows, true) >= 1,
      );
      assert.ok(advisoryLockCount(lockRows, true) >= 1);
    } finally {
      releaseCallback.resolve();
      await run;
    }
  });
});

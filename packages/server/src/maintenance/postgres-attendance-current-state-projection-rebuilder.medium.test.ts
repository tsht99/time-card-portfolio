import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceAggregate } from "@repo/attendance";
import {
  AttendanceCurrentStateProjectionRebuildError,
  PostgresAttendanceCurrentStateProjectionRebuilder,
  PostgresAttendanceEventStore,
} from "@repo/attendance/infrastructure";
import {
  attendanceCurrentStateProjectionMetadata,
  attendanceCurrentStates,
  attendanceEvents,
  users,
} from "@repo/db";
import { asc, eq } from "drizzle-orm";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";

const firstUserId = "11111111-1111-4111-8111-111111111111";
const secondUserId = "11111111-1111-4111-8111-111111111112";
const orphanUserId = "11111111-1111-4111-8111-111111111113";
const missingUserId = "11111111-1111-4111-8111-111111111114";
const completedAttendanceId = "22222222-2222-4222-8222-222222222222";
const correctedAttendanceId = "33333333-3333-4333-8333-333333333333";
const cancelledAttendanceId = "44444444-4444-4444-8444-444444444444";
const orphanAttendanceId = "55555555-5555-4555-8555-555555555555";
const invalidAttendanceId = "66666666-6666-4666-8666-666666666666";
const interleavedAttendanceId = "77777777-7777-4777-8777-777777777777";
const attendanceCurrentStateProjectionName = "attendance-current-state-v2";

async function replayAttendanceCurrentStates(
  store: PostgresAttendanceEventStore,
) {
  const streams = new Map<
    string,
    Awaited<ReturnType<typeof store.readAll>>[number][]
  >();
  for (const event of await store.readAll()) {
    const stream = streams.get(event.attendanceId) ?? [];
    stream.push(event);
    streams.set(event.attendanceId, stream);
  }
  const states: Array<{
    attendanceId: string;
    userId: string;
    attendanceDate: string;
    workPeriod: "day" | "night";
    clockInAt: Date;
    clockOutAt: Date | null;
    eventVersion: number;
    isCancelled: boolean;
  }> = [];
  for (const stream of streams.values()) {
    const aggregate = AttendanceAggregate.replay(stream);
    const {
      attendanceId,
      userId,
      attendanceDate,
      workPeriod,
      clockInAt,
      clockOutAt,
    } = aggregate.state;
    if (
      userId === null ||
      attendanceDate === null ||
      workPeriod === null ||
      clockInAt === null
    )
      continue;
    states.push({
      attendanceId,
      userId,
      attendanceDate,
      workPeriod,
      clockInAt,
      clockOutAt,
      eventVersion: aggregate.version,
      isCancelled: aggregate.isCancelled,
    });
  }
  return states;
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

async function waitForTableLock(
  pool: Awaited<ReturnType<typeof startMediumTestDatabase>>["pool"],
  relation: "attendance_events" | "attendance_current_states",
  mode: string,
  granted: boolean,
): Promise<void> {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const result = await pool.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM pg_locks
        WHERE relation = $1::regclass
          AND mode = $2
          AND granted = $3
      `,
      [relation, mode, granted],
    );
    if (result.rows[0]?.count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${relation} ${mode} lock.`);
}

async function waitForAdvisoryLockState(
  pool: Awaited<ReturnType<typeof startMediumTestDatabase>>["pool"],
  predicate: (rows: readonly { granted: boolean; count: number }[]) => boolean,
): Promise<void> {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const result = await pool.query<{ granted: boolean; count: number }>(`
      SELECT granted, count(*)::int AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
      GROUP BY granted
      ORDER BY granted DESC
    `);
    if (predicate(result.rows)) return;
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
      { id: firstUserId, lineUserId: "rebuilder-first-user" },
      { id: secondUserId, lineUserId: "rebuilder-second-user" },
      { id: orphanUserId, lineUserId: "rebuilder-orphan-user" },
    ]);
    return await operation(database);
  } finally {
    await database.close();
  }
}

async function rebuild(
  database: Awaited<ReturnType<typeof startMediumTestDatabase>>,
) {
  const client = await database.pool.connect();
  try {
    return await new PostgresAttendanceCurrentStateProjectionRebuilder(
      client,
    ).rebuild();
  } finally {
    client.release();
  }
}

async function projectionMetadata(
  database: Awaited<ReturnType<typeof startMediumTestDatabase>>,
) {
  const [metadata] = await database.db
    .select()
    .from(attendanceCurrentStateProjectionMetadata)
    .where(
      eq(
        attendanceCurrentStateProjectionMetadata.projectionName,
        attendanceCurrentStateProjectionName,
      ),
    );
  return metadata;
}

async function projectionStates(
  database: Awaited<ReturnType<typeof startMediumTestDatabase>>,
) {
  return database.db
    .select()
    .from(attendanceCurrentStates)
    .orderBy(asc(attendanceCurrentStates.attendanceId));
}

function orderedStates<T extends { attendanceId: string }>(
  states: readonly T[],
) {
  return [...states].sort((first, second) =>
    first.attendanceId.localeCompare(second.attendanceId),
  );
}

test("Event Store全履歴からCurrent State Projectionを全置換で再構築する", async () => {
  await withMediumDatabase(async (database) => {
    const store = new PostgresAttendanceEventStore(database.db);

    const completed = AttendanceAggregate.start(completedAttendanceId);
    await store.append(
      [
        completed.clockIn({
          userId: firstUserId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockInAt: new Date("2026-08-22T09:00:00.000Z"),
        }),
        completed.clockOut({
          clockOutAt: new Date("2026-08-22T18:00:00.000Z"),
        }),
      ],
      { expectedVersion: 0, performedByUserId: firstUserId },
    );

    const corrected = AttendanceAggregate.start(correctedAttendanceId);
    await store.append(
      [
        corrected.clockIn({
          userId: secondUserId,
          attendanceDate: "2026-08-23",
          workPeriod: "night",
          clockInAt: new Date("2026-08-23T13:00:00.000Z"),
        }),
        corrected.correctClockInTime({
          clockInAt: new Date("2026-08-24T13:00:00.000Z"),
        }),
      ],
      { expectedVersion: 0, performedByUserId: secondUserId },
    );

    const cancelled = AttendanceAggregate.start(cancelledAttendanceId);
    await store.append(
      [
        cancelled.clockIn({
          userId: firstUserId,
          attendanceDate: "2026-08-25",
          workPeriod: "day",
          clockInAt: new Date("2026-08-25T09:00:00.000Z"),
        }),
      ],
      { expectedVersion: 0, performedByUserId: firstUserId },
    );
    const cancellation = AttendanceAggregate.replay(
      await store.readStream(cancelledAttendanceId),
    ).cancel();
    await store.append([cancellation], {
      expectedVersion: 1,
      performedByUserId: firstUserId,
    });

    await database.db.delete(attendanceCurrentStates);
    await database.db.insert(attendanceCurrentStates).values({
      attendanceId: orphanAttendanceId,
      userId: orphanUserId,
      attendanceDate: "2026-08-01",
      workPeriod: "day",
      clockInAt: new Date("2026-08-01T09:00:00.000Z"),
      clockOutAt: null,
      eventVersion: 1,
      isCancelled: false,
    });

    const result = await rebuild(database);
    const replayed = await replayAttendanceCurrentStates(store);

    assert.equal(result.currentStateCount, replayed.length);
    assert.deepEqual(await projectionStates(database), orderedStates(replayed));
    assert.equal(
      (await projectionStates(database)).some(
        (state) => state.attendanceId === cancelledAttendanceId,
      ),
      true,
    );
    assert.equal(
      (await projectionStates(database)).some(
        (state) => state.attendanceId === orphanAttendanceId,
      ),
      false,
    );
    assert.equal((await projectionMetadata(database))?.isReady, true);
  });
});

test("Event Storeが空でも空のProjectionをreadyにする", async () => {
  await withMediumDatabase(async (database) => {
    const result = await rebuild(database);

    assert.equal(result.currentStateCount, 0);
    assert.deepEqual(await projectionStates(database), []);
    assert.equal((await projectionMetadata(database))?.isReady, true);
  });
});

test("同時のrebuildはsession advisory lockで全lifecycleを直列化する", async () => {
  await withMediumDatabase(async (database) => {
    const blocker = await database.pool.connect();
    const firstClient = await database.pool.connect();
    const secondClient = await database.pool.connect();
    let firstRun: Promise<unknown> | undefined;
    let secondRun: Promise<unknown> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE attendance_current_states IN SHARE MODE");

      firstRun = new PostgresAttendanceCurrentStateProjectionRebuilder(
        firstClient,
      ).rebuild();
      await waitForTableLock(
        database.pool,
        "attendance_events",
        "ShareLock",
        true,
      );
      assert.equal((await projectionMetadata(database))?.isReady, false);

      secondRun = new PostgresAttendanceCurrentStateProjectionRebuilder(
        secondClient,
      ).rebuild();
      await waitForAdvisoryLockState(
        database.pool,
        (rows) =>
          advisoryLockCount(rows, true) >= 1 &&
          advisoryLockCount(rows, false) >= 1,
      );

      await blocker.query("COMMIT");
      await Promise.all([firstRun, secondRun]);

      assert.deepEqual(await projectionStates(database), []);
      assert.equal((await projectionMetadata(database))?.isReady, true);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled(
        [firstRun, secondRun].filter(
          (run): run is Promise<unknown> => run !== undefined,
        ),
      );
      blocker.release();
      firstClient.release();
      secondClient.release();
    }
  });
});

test("不正なEvent Streamのreplay失敗ではProjectionをnot-readyのまま維持する", async () => {
  await withMediumDatabase(async (database) => {
    const before = {
      attendanceId: orphanAttendanceId,
      userId: orphanUserId,
      attendanceDate: "2026-08-01",
      workPeriod: "day" as const,
      clockInAt: new Date("2026-08-01T09:00:00.000Z"),
      clockOutAt: null,
      eventVersion: 1,
      isCancelled: false,
    };
    await database.db.insert(attendanceCurrentStates).values(before);
    await database.db.insert(attendanceCurrentStateProjectionMetadata).values({
      projectionName: attendanceCurrentStateProjectionName,
      isReady: true,
    });
    await database.db.insert(attendanceEvents).values({
      attendanceId: invalidAttendanceId,
      performedByUserId: firstUserId,
      eventVersion: 1,
      eventType: "AttendanceClockedIn",
      payload: { userId: "synthetic-secret-payload" },
    });
    const eventsBefore = await database.db
      .select()
      .from(attendanceEvents)
      .orderBy(asc(attendanceEvents.eventId));

    await assert.rejects(rebuild(database), (error: unknown) => {
      assert.ok(error instanceof AttendanceCurrentStateProjectionRebuildError);
      assert.equal(error.stage, "deserialize_event");
      assert.equal(error.attendanceId, invalidAttendanceId);
      assert.equal(
        error.sourceErrorType,
        "AttendanceEventStoreCorruptionError",
      );
      assert.doesNotMatch(error.message, /synthetic-secret-payload/);
      assert.doesNotMatch(
        error.sourceStackFrames.join("\n"),
        /synthetic-secret/,
      );
      assert.doesNotMatch(JSON.stringify(error), /synthetic-secret-payload/);
      return true;
    });

    assert.deepEqual(await projectionStates(database), [before]);
    assert.equal((await projectionMetadata(database))?.isReady, false);
    assert.deepEqual(
      await database.db
        .select()
        .from(attendanceEvents)
        .orderBy(asc(attendanceEvents.eventId)),
      eventsBefore,
    );
  });
});

test("deserialize後のAggregate replay失敗は失敗streamのdiagnostic contextを保持する", async () => {
  await withMediumDatabase(async (database) => {
    const before = {
      attendanceId: orphanAttendanceId,
      userId: orphanUserId,
      attendanceDate: "2026-08-01",
      workPeriod: "day" as const,
      clockInAt: new Date("2026-08-01T09:00:00.000Z"),
      clockOutAt: null,
      eventVersion: 1,
      isCancelled: false,
    };
    await database.db.insert(attendanceCurrentStates).values(before);
    await database.db.insert(attendanceCurrentStateProjectionMetadata).values({
      projectionName: attendanceCurrentStateProjectionName,
      isReady: true,
    });
    await database.db.insert(attendanceEvents).values({
      attendanceId: invalidAttendanceId,
      performedByUserId: firstUserId,
      eventVersion: 1,
      eventType: "AttendanceClockedOut",
      payload: { clockOutAt: "2026-08-26T18:00:00.000Z" },
    });

    await assert.rejects(rebuild(database), (error: unknown) => {
      assert.ok(error instanceof AttendanceCurrentStateProjectionRebuildError);
      assert.equal(error.stage, "replay_event_stream");
      assert.equal(error.attendanceId, invalidAttendanceId);
      assert.equal(error.sourceErrorType, "InvalidAttendanceTransitionError");
      assert.doesNotMatch(error.message, /must start with a clock-in/);
      return true;
    });

    assert.deepEqual(await projectionStates(database), [before]);
    assert.equal((await projectionMetadata(database))?.isReady, false);
  });
});

test("replay結果を保存できないrebuildはProjectionを部分commitせずnot-readyにする", async () => {
  await withMediumDatabase(async (database) => {
    const before = {
      attendanceId: orphanAttendanceId,
      userId: orphanUserId,
      attendanceDate: "2026-08-01",
      workPeriod: "day" as const,
      clockInAt: new Date("2026-08-01T09:00:00.000Z"),
      clockOutAt: null,
      eventVersion: 1,
      isCancelled: false,
    };
    await database.db.insert(attendanceCurrentStates).values(before);
    await database.db.insert(attendanceCurrentStateProjectionMetadata).values({
      projectionName: attendanceCurrentStateProjectionName,
      isReady: true,
    });
    await database.db.insert(attendanceEvents).values({
      attendanceId: invalidAttendanceId,
      performedByUserId: firstUserId,
      eventVersion: 1,
      eventType: "AttendanceClockedIn",
      payload: {
        userId: missingUserId,
        attendanceDate: "2026-08-26",
        workPeriod: "day",
        clockInAt: "2026-08-26T09:00:00.000Z",
      },
    });
    const eventsBefore = await database.db
      .select()
      .from(attendanceEvents)
      .orderBy(asc(attendanceEvents.eventId));

    await assert.rejects(rebuild(database), (error: unknown) => {
      assert.ok(error instanceof AttendanceCurrentStateProjectionRebuildError);
      assert.equal(error.stage, "replace_projection");
      assert.equal(error.attendanceId, undefined);
      return true;
    });

    assert.deepEqual(await projectionStates(database), [before]);
    assert.equal((await projectionMetadata(database))?.isReady, false);
    assert.deepEqual(
      await database.db
        .select()
        .from(attendanceEvents)
        .orderBy(asc(attendanceEvents.eventId)),
      eventsBefore,
    );
  });
});

test("rebuild中のattendance_events SHARE lockはappendを待機させ、appendを失わない", async () => {
  await withMediumDatabase(async (database) => {
    const store = new PostgresAttendanceEventStore(database.db);
    const aggregate = AttendanceAggregate.start(interleavedAttendanceId);
    const clockIn = aggregate.clockIn({
      userId: firstUserId,
      attendanceDate: "2026-08-27",
      workPeriod: "day",
      clockInAt: new Date("2026-08-27T09:00:00.000Z"),
    });
    const clockOut = aggregate.clockOut({
      clockOutAt: new Date("2026-08-27T18:00:00.000Z"),
    });
    await store.append([clockIn], {
      expectedVersion: 0,
      performedByUserId: firstUserId,
    });

    const blocker = await database.pool.connect();
    const rebuildClient = await database.pool.connect();
    let rebuildRun: Promise<unknown> | undefined;
    let appendRun: Promise<void> | undefined;
    let appendCompleted = false;

    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE attendance_current_states IN SHARE MODE");

      rebuildRun = new PostgresAttendanceCurrentStateProjectionRebuilder(
        rebuildClient,
      ).rebuild();

      await waitForTableLock(
        database.pool,
        "attendance_events",
        "ShareLock",
        true,
      );
      assert.equal((await projectionMetadata(database))?.isReady, false);

      appendRun = store
        .append([clockOut], {
          expectedVersion: 1,
          performedByUserId: firstUserId,
        })
        .then(() => {
          appendCompleted = true;
        });
      await waitForTableLock(
        database.pool,
        "attendance_events",
        "RowExclusiveLock",
        false,
      );
      assert.equal(appendCompleted, false);

      await blocker.query("COMMIT");
      await withTimeout(rebuildRun, "the rebuild to commit");
      assert.equal((await projectionMetadata(database))?.isReady, true);
      await withTimeout(appendRun, "the waiting append");

      assert.deepEqual(
        await projectionStates(database),
        orderedStates(await replayAttendanceCurrentStates(store)),
      );
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled(
        [rebuildRun, appendRun].filter(
          (run): run is Promise<unknown> => run !== undefined,
        ),
      );
      blocker.release();
      rebuildClient.release();
    }
  });
});

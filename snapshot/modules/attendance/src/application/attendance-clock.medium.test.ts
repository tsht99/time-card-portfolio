import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceAggregate } from "../domain/attendance.ts";
import { attendanceCurrentStateProjectionMetadata } from "../schema/index.ts";
import {
  advisoryLockCount,
  advisoryLockKey,
  waitForAdvisoryLockState,
} from "../test/advisory-locks.ts";
import {
  createPostgresAttendanceEventStore,
  startMediumTestDatabase,
  users,
} from "../test/medium-postgres.ts";
import {
  AttendanceClockAlreadyWorkingError,
  createAttendanceClockService,
} from "./attendance-clock.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const dayAttendanceId = "22222222-2222-4222-8222-222222222222";
const nightAttendanceId = "33333333-3333-4333-8333-333333333333";
const userLockKey = advisoryLockKey(`user\0${userId}`);

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

test("実PostgreSQL上で同一ユーザーのday/night clock-inはuser lockで直列化される", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values({
      id: userId,
      lineUserId: "medium-clock-target",
      displayName: "Medium Clock Target",
    });

    const store = createPostgresAttendanceEventStore(database);
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

      await waitForAdvisoryLockState(
        database.pool,
        userLockKey,
        (rows) =>
          advisoryLockCount(rows, true) >= 1 &&
          advisoryLockCount(rows, false) >= 2,
        "both clock-ins to wait for the same user lock",
      );
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

test("多数の完了済み勤怠があるready Projectionではclock-inが全履歴を読まない", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values({
      id: userId,
      lineUserId: "medium-clock-history-target",
      displayName: "Medium Clock History Target",
    });
    const store = createPostgresAttendanceEventStore(database);
    for (let index = 0; index < 60; index += 1) {
      const aggregate = AttendanceAggregate.start(
        `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      );
      const clockInAt = new Date(
        `2026-08-22T09:${String(index).padStart(2, "0")}:00.000Z`,
      );
      const events = [
        aggregate.clockIn({
          userId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockInAt,
        }),
        aggregate.clockOut({
          clockOutAt: new Date(clockInAt.getTime() + 30 * 60_000),
        }),
      ];
      await store.append(events, {
        expectedVersion: 0,
        performedByUserId: userId,
      });
    }
    await database.db
      .insert(attendanceCurrentStateProjectionMetadata)
      .values({
        projectionName: "attendance-current-state-v2",
        isReady: true,
      })
      .onConflictDoUpdate({
        target: attendanceCurrentStateProjectionMetadata.projectionName,
        set: { isReady: true },
      });

    let userStreamReads = 0;
    const storePrototype = Object.getPrototypeOf(store) as {
      readStreamsByUserId: typeof store.readStreamsByUserId;
    };
    const readStreamsByUserId = storePrototype.readStreamsByUserId;
    storePrototype.readStreamsByUserId = async function (id) {
      userStreamReads += 1;
      return readStreamsByUserId.call(this, id);
    };
    const clock = createAttendanceClockService(store, {
      createAttendanceId: () => "55555555-5555-4555-8555-555555555555",
    });
    try {
      await clock.execute({
        userId,
        performedByUserId: userId,
        workPeriod: "day",
        eventType: "clock_in",
        occurredAt: new Date("2026-08-25T09:00:00.000Z"),
      });
    } finally {
      storePrototype.readStreamsByUserId = readStreamsByUserId;
    }
    assert.equal(userStreamReads, 0);
  } finally {
    await database.close();
  }
});

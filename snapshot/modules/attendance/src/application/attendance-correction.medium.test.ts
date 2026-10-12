import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceAggregate } from "../domain/attendance.ts";
import {
  AttendanceTimeOverlapError,
  findAttendanceTimeOverlap,
} from "../domain/attendance-overlap.ts";
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
import { createAttendanceCorrectionService } from "./attendance-correction.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attendanceAId = "22222222-2222-4222-8222-222222222222";
const attendanceBId = "33333333-3333-4333-8333-333333333333";
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

    const store = createPostgresAttendanceEventStore(database);
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

      await waitForAdvisoryLockState(
        database.pool,
        userLockKey,
        (rows) =>
          advisoryLockCount(rows, true) >= 1 &&
          advisoryLockCount(rows, false) >= 2,
        "both corrections to wait for the user lock",
      );
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
    assert.ok(finalA.clockInAt);
    assert.ok(finalA.clockOutAt);
    assert.ok(finalB.clockInAt);
    assert.ok(finalB.clockOutAt);
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

test("実PostgreSQL上の訂正は既存完了区間内の0分勤務を許可し正の長さの重複を拒否する", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      {
        id: userId,
        lineUserId: "medium-zero-correction-target",
        displayName: "Medium Zero Correction Target",
      },
      {
        id: actorId,
        lineUserId: "medium-zero-correction-admin",
        displayName: "Medium Zero Correction Admin",
        role: "admin",
        status: "active",
      },
    ]);
    const store = createPostgresAttendanceEventStore(database);
    const existing = AttendanceAggregate.start(attendanceBId);
    const target = AttendanceAggregate.start(attendanceAId);
    await store.append(
      [
        existing.clockIn({
          userId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockInAt: at("09:00"),
        }),
        existing.clockOut({ clockOutAt: at("12:00") }),
      ],
      { expectedVersion: 0, performedByUserId: actorId },
    );
    await store.append(
      [
        target.clockIn({
          userId,
          attendanceDate: "2026-08-22",
          workPeriod: "night",
          clockInAt: at("13:00"),
        }),
        target.clockOut({ clockOutAt: at("14:00") }),
      ],
      { expectedVersion: 0, performedByUserId: actorId },
    );

    const service = createAttendanceCorrectionService(store);
    const actor = {
      userId: actorId,
      role: "admin" as const,
      status: "active" as const,
    };
    await service.execute({
      attendanceId: attendanceAId,
      expectedVersion: 2,
      actor,
      changes: { clockInAt: at("11:00"), clockOutAt: at("11:00") },
    });
    const corrected = AttendanceAggregate.replay(
      await store.readStream(attendanceAId),
    );
    assert.equal(corrected.clockInAt?.getTime(), at("11:00").getTime());
    assert.equal(corrected.clockOutAt?.getTime(), at("11:00").getTime());

    await assert.rejects(
      service.execute({
        attendanceId: attendanceAId,
        expectedVersion: corrected.version,
        actor,
        changes: { clockOutAt: at("11:30") },
      }),
      AttendanceTimeOverlapError,
    );
  } finally {
    await database.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  AttendanceAccessForbiddenError,
  AttendanceClockAlreadyWorkingError,
  AttendanceManualCreationForbiddenError,
  createAttendanceApplication,
} from "@repo/attendance";
import { PostgresAttendanceEventStore } from "@repo/attendance/internal";
import * as attendanceSchema from "@repo/attendance/schema";
import { startMediumTestDatabase as startDatabase } from "@repo/test-support/medium-postgres";
import { users } from "@repo/users/schema";
import { eq } from "drizzle-orm";
import { PostgresAttendanceEventStoreUnitOfWork } from "./attendance-composition.ts";

const staffId = "11111111-1111-4111-8111-111111111111";
const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const schema = { ...attendanceSchema, users };

async function withTimeout<T>(promise: Promise<T>, description: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}.`)),
          2_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function startMediumTestDatabase() {
  return startDatabase({ schema });
}

function createPostgresAttendanceEventStore(
  database: Awaited<ReturnType<typeof startMediumTestDatabase>>,
) {
  return new PostgresAttendanceEventStore(database.db);
}

function createUserReferences() {
  const states = new Map([
    [
      staffId,
      {
        userId: staffId,
        role: "staff",
        status: "active",
        displayName: "Staff",
      },
    ],
    [
      adminId,
      {
        userId: adminId,
        role: "admin",
        status: "active",
        displayName: "Admin",
      },
    ],
  ]);
  return {
    getUsers: async () => [...states.values()],
    getUserById: async (userId: string) => states.get(userId) ?? null,
  };
}

test("実PostgreSQL上でAttendance Applicationが最新actor stateを強制し、同時打刻を直列化する", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      {
        id: staffId,
        lineUserId: "medium-attendance-authorization-staff",
        displayName: "Staff",
        status: "active",
      },
      {
        id: adminId,
        lineUserId: "medium-attendance-authorization-admin",
        displayName: "Admin",
        role: "admin",
        status: "active",
      },
    ]);
    const application = createAttendanceApplication({
      eventStore: createPostgresAttendanceEventStore(database),
      currentStateReadModel: {
        async upsert() {},
        async query() {
          return { kind: "not-ready" as const };
        },
      },
      userReferences: createUserReferences(),
      transactionUnitOfWork: new PostgresAttendanceEventStoreUnitOfWork(
        database.db,
      ),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
    });
    const spoofedAdmin = { userId: staffId, role: "admin", status: "active" };

    await assert.rejects(
      application.getAdminAttendance(spoofedAdmin, {
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
      }),
      AttendanceAccessForbiddenError,
    );

    const clockRequest = (workPeriod: "day" | "night") =>
      application.clock(
        { userId: staffId },
        {
          eventType: "clock_in",
          workPeriod,
          occurredAt: "2026-08-22T09:00:00.000Z",
        },
      );
    const outcomes = await Promise.allSettled([
      clockRequest("day"),
      clockRequest("night"),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(
      rejected && rejected.reason instanceof AttendanceClockAlreadyWorkingError,
    );
    const events =
      await createPostgresAttendanceEventStore(database).readStreamsByUserId(
        staffId,
      );
    assert.equal(
      events.filter((event) => event.eventType === "AttendanceClockedIn")
        .length,
      1,
    );
    await database.db
      .update(users)
      .set({ status: "inactive" })
      .where(eq(users.id, adminId));
    await assert.rejects(
      application.createAdminAttendance(
        { userId: adminId },
        {
          userId: staffId,
          workPeriod: "day",
          clockInAt: "2026-08-23T09:00:00+09:00",
          clockOutAt: "2026-08-23T18:00:00+09:00",
        },
      ),
      AttendanceManualCreationForbiddenError,
    );
  } finally {
    await database.close();
  }
});

test("認可判定前にactorが利用停止になった勤怠作成を拒否する", async () => {
  const database = await startMediumTestDatabase();
  let resume!: () => void;
  let creation: Promise<unknown> | undefined;
  try {
    await database.db.insert(users).values([
      {
        id: staffId,
        lineUserId: "medium-attendance-preauth-staff",
        displayName: "スタッフ",
      },
      {
        id: adminId,
        lineUserId: "medium-attendance-preauth-admin",
        displayName: "管理者",
        role: "admin",
        status: "active",
      },
    ]);
    const baseUnitOfWork = new PostgresAttendanceEventStoreUnitOfWork(
      database.db,
    );
    let actorReadStarted!: () => void;
    const actorRead = new Promise<void>((resolve) => {
      actorReadStarted = resolve;
    });
    const continueAuthorization = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const application = createAttendanceApplication({
      eventStore: createPostgresAttendanceEventStore(database),
      currentStateReadModel: {
        async upsert() {},
        async query() {
          return { kind: "not-ready" as const };
        },
      },
      userReferences: createUserReferences(),
      transactionUnitOfWork: {
        runInTransaction(operation) {
          return baseUnitOfWork.runInTransaction(async (context) => {
            const usersReader = {
              getUsers: () => context.users.getUsers(),
              async getUserById(userId: string) {
                if (userId === adminId) {
                  actorReadStarted();
                  await continueAuthorization;
                }
                return context.users.getUserById(userId);
              },
            };
            return operation({ ...context, users: usersReader });
          });
        },
      },
    });

    creation = application.createAdminAttendance(
      { userId: adminId },
      {
        userId: staffId,
        workPeriod: "day",
        clockInAt: "2026-08-22T09:00:00+09:00",
        clockOutAt: "2026-08-22T18:00:00+09:00",
      },
    );
    await withTimeout(actorRead, "actor authorization read to start");
    await withTimeout(
      database.db
        .update(users)
        .set({ status: "inactive" })
        .where(eq(users.id, adminId)),
      "actor deactivation before authorization",
    );
    resume();
    await assert.rejects(
      withTimeout(creation, "pre-authorization denial"),
      AttendanceManualCreationForbiddenError,
    );
    assert.deepEqual(
      await createPostgresAttendanceEventStore(database).readStreamsByUserId(
        staffId,
      ),
      [],
    );
  } finally {
    resume?.();
    if (creation)
      await withTimeout(
        creation.catch(() => undefined),
        "pre-authorization transaction cleanup",
      );
    await database.close();
  }
});

test("認可後のactor・target state変更は実行中の勤怠作成を止めない", async () => {
  const database = await startMediumTestDatabase();
  let resume!: () => void;
  let creation: Promise<unknown> | undefined;
  let updates: Promise<unknown> | undefined;
  try {
    await database.db.insert(users).values([
      {
        id: staffId,
        lineUserId: "medium-attendance-lock-staff",
        displayName: "Staff",
        status: "active",
      },
      {
        id: adminId,
        lineUserId: "medium-attendance-lock-admin",
        displayName: "Admin",
        role: "admin",
        status: "active",
      },
    ]);
    const baseUnitOfWork = new PostgresAttendanceEventStoreUnitOfWork(
      database.db,
    );
    let authorized!: () => void;
    const authorizationReached = new Promise<void>((resolve) => {
      authorized = resolve;
    });
    const continueCommand = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const application = createAttendanceApplication({
      eventStore: createPostgresAttendanceEventStore(database),
      currentStateReadModel: {
        async upsert() {},
        async query() {
          return { kind: "not-ready" as const };
        },
      },
      userReferences: createUserReferences(),
      transactionUnitOfWork: {
        runInTransaction(operation) {
          return baseUnitOfWork.runInTransaction(async (context) => {
            const usersReader = {
              getUsers: () => context.users.getUsers(),
              async getUserById(userId: string) {
                const user = await context.users.getUserById(userId);
                if (userId === staffId && user) {
                  authorized();
                  await continueCommand;
                }
                return user;
              },
            };
            return operation({ ...context, users: usersReader });
          });
        },
      },
    });
    creation = application.createAdminAttendance(
      { userId: adminId },
      {
        userId: staffId,
        workPeriod: "day",
        clockInAt: "2026-08-22T09:00:00+09:00",
        clockOutAt: "2026-08-22T18:00:00+09:00",
      },
    );
    await withTimeout(authorizationReached, "authorization to finish");
    updates = Promise.all([
      database.db
        .update(users)
        .set({ status: "inactive" })
        .where(eq(users.id, adminId)),
      database.db
        .update(users)
        .set({ role: "admin" })
        .where(eq(users.id, staffId)),
    ]);
    await withTimeout(updates, "actor and target updates after authorization");
    resume();
    await withTimeout(creation, "attendance creation after authorization");
    assert.ok(
      (
        await createPostgresAttendanceEventStore(database).readStreamsByUserId(
          staffId,
        )
      ).length > 0,
    );
  } finally {
    resume?.();
    if (creation) {
      await withTimeout(
        creation.catch(() => undefined),
        "attendance transaction cleanup",
      );
    }
    if (updates) {
      await withTimeout(
        updates.catch(() => undefined),
        "user update cleanup",
      );
    }
    await database.close();
  }
});

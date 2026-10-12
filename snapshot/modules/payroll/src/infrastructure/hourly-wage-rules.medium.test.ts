import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresDatabase } from "@repo/postgres";
import { authSessions, users } from "@repo/users/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { createHourlyWageRuleManagementApplication as createApplication } from "../application/hourly-wage-rules.ts";
import type { PayrollUserReferenceReader } from "../application/ports/user-reference.ts";
import { MAX_HOURLY_WAGE } from "../domain/hourly-wage-rule.ts";
import { hourlyWageRules } from "../schema/hourly-wage-rules.ts";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";
import { PostgresHourlyWageRuleManagementPersistenceAdapter } from "./postgres-hourly-wage-rule-management-persistence-adapter.ts";

function createHourlyWageRuleManagementApplication(dependencies: {
  db: PostgresDatabase;
  userReferences: PayrollUserReferenceReader;
}) {
  return createApplication({
    unitOfWork: {
      async run(operation) {
        return dependencies.db.transaction(async (tx) => {
          const references: PayrollUserReferenceReader = {
            async getUserById(userId) {
              const [row] = await tx
                .select({
                  userId: users.id,
                  role: users.role,
                  status: users.status,
                  displayName: users.displayName,
                })
                .from(users)
                .where(eq(users.id, userId));
              return row ?? null;
            },
            async getUsers() {
              return tx
                .select({
                  userId: users.id,
                  role: users.role,
                  status: users.status,
                  displayName: users.displayName,
                })
                .from(users);
            },
          };
          return operation({
            users: references,
            hourlyWageRuleManagementPersistence:
              new PostgresHourlyWageRuleManagementPersistenceAdapter(tx, true),
            hourlyWageRuleReadStore: {
              async findForPayrollEstimate() {
                return [];
              },
            },
          });
        });
      },
    },
  });
}

function testUserReferences(db: PostgresDatabase): PayrollUserReferenceReader {
  return {
    async getUserById(userId) {
      const [row] = await db
        .select({
          userId: users.id,
          role: users.role,
          status: users.status,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.id, userId));
      return row ? { ...row, role: row.role as "staff" | "admin" } : null;
    },
    async getUsers() {
      return db
        .select({
          userId: users.id,
          role: users.role,
          status: users.status,
          displayName: users.displayName,
        })
        .from(users);
    },
  };
}

test("default時給CRUDはunique conflictを結果化し、確定済み時給を変更しない", async () => {
  const database = await startMediumTestDatabase();
  const application = createHourlyWageRuleManagementApplication({
    db: database.db,
    userReferences: testUserReferences(database.db),
  });
  try {
    const [{ id: adminId }] = await database.db
      .insert(users)
      .values({
        lineUserId: "application-hourly-wage-rules-admin",
        displayName: "時給管理者",
        role: "admin",
        status: "active",
      })
      .returning({ id: users.id });
    const [{ id: staffId }] = await database.db
      .insert(users)
      .values({
        lineUserId: "application-hourly-wage-rules-staff",
        displayName: "時給スタッフ",
        role: "staff",
        status: "active",
      })
      .returning({ id: users.id });
    assert.ok(staffId);
    const input = {
      actorUserId: adminId,
      userId: staffId,
      workPeriod: "day" as const,
      dayType: "mon" as const,
      hourlyWage: 1200,
      effectiveFrom: "2026-08-01",
    };
    const created = await application.createHourlyWageRule(input);
    assert.equal(created.kind, "success");
    assert.deepEqual(await application.createHourlyWageRule(input), {
      kind: "already-exists",
    });
    if (created.kind !== "success") throw new Error("Expected created rules.");
    assert.equal(created.hourlyWageRule.version, 1);
    assert.deepEqual(
      await application.getHourlyWageRules({
        actorUserId: adminId,
        userId: staffId,
      }),
      {
        kind: "success",
        hourlyWageRules: [created.hourlyWageRule],
      },
    );
    const updated = await application.updateHourlyWageRule({
      ...input,
      hourlyWageRuleId: created.hourlyWageRule.id,
      expectedVersion: created.hourlyWageRule.version,
      workPeriod: "night",
      dayType: "holiday",
      hourlyWage: 1800,
      effectiveFrom: "2027-01-01",
    });
    assert.equal(updated.kind, "success");
    if (updated.kind !== "success") throw new Error("Expected updated rules.");
    assert.equal(updated.hourlyWageRule.version, 2);
    const staleUpdate = await application.updateHourlyWageRule({
      ...input,
      hourlyWageRuleId: created.hourlyWageRule.id,
      expectedVersion: 1,
      workPeriod: "day",
      dayType: "sun",
      hourlyWage: 1900,
      effectiveFrom: "2028-01-01",
    });
    assert.deepEqual(staleUpdate, { kind: "version-conflict" });
    assert.deepEqual(
      await database.db
        .select({
          workPeriod: hourlyWageRules.workPeriod,
          dayType: hourlyWageRules.dayType,
          hourlyWage: hourlyWageRules.hourlyWage,
          effectiveFrom: hourlyWageRules.effectiveFrom,
          version: hourlyWageRules.version,
        })
        .from(hourlyWageRules)
        .where(eq(hourlyWageRules.id, created.hourlyWageRule.id)),
      [
        {
          workPeriod: "night",
          dayType: "holiday",
          hourlyWage: 1800,
          effectiveFrom: "2027-01-01",
          version: 2,
        },
      ],
    );
    assert.deepEqual(
      await application.deleteHourlyWageRule({
        actorUserId: adminId,
        userId: staffId,
        hourlyWageRuleId: created.hourlyWageRule.id,
        expectedVersion: 1,
      }),
      { kind: "version-conflict" },
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(hourlyWageRules)
          .where(eq(hourlyWageRules.id, created.hourlyWageRule.id))
      ).length,
      1,
    );
    assert.deepEqual(
      await application.deleteHourlyWageRule({
        actorUserId: adminId,
        userId: staffId,
        hourlyWageRuleId: created.hourlyWageRule.id,
        expectedVersion: 2,
      }),
      { kind: "success", hourlyWageRuleId: created.hourlyWageRule.id },
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(hourlyWageRules)
          .where(eq(hourlyWageRules.id, created.hourlyWageRule.id))
      ).length,
      0,
    );
    assert.deepEqual(
      await application.deleteHourlyWageRule({
        actorUserId: adminId,
        userId: staffId,
        hourlyWageRuleId: created.hourlyWageRule.id,
        expectedVersion: 2,
      }),
      { kind: "rule-not-found" },
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(authSessions)
          .where(
            and(
              eq(authSessions.userId, staffId),
              isNull(authSessions.revokedAt),
            ),
          )
      ).length,
      0,
    );
  } finally {
    await database.close();
  }
});

test("authorization 対象ユーザーの行ロックは時給変更を待たせない", async () => {
  const database = await startMediumTestDatabase();
  const application = createHourlyWageRuleManagementApplication({
    db: database.db,
    userReferences: testUserReferences(database.db),
  });
  try {
    const [{ id: adminId }, { id: staffId }] = await database.db
      .insert(users)
      .values([
        {
          lineUserId: "payroll-authorization-no-lock-admin",
          displayName: "管理者",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "payroll-authorization-no-lock-staff",
          displayName: "スタッフ",
          role: "staff",
          status: "active",
        },
      ])
      .returning({ id: users.id });

    let release!: () => void;
    let locked!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const userRowLocks = database.db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, adminId))
        .for("update");
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, staffId))
        .for("no key update");
      locked();
      await hold;
    });
    await lockReady;

    const mutation = application.createHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1500,
      effectiveFrom: "2026-08-01",
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        mutation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error("Hourly wage mutation stalled on a user row lock."),
              ),
            1_000,
          );
        }),
      ]);
      assert.equal(result.kind, "success");
    } finally {
      if (timeout) clearTimeout(timeout);
      release();
      await userRowLocks;
      await mutation;
    }
  } finally {
    await database.close();
  }
});

test("個別更新と重なる一括更新は最新baselineで競合し、部分保存しない", async () => {
  const database = await startMediumTestDatabase();
  try {
    const [{ id: adminId }, { id: staffId }] = await database.db
      .insert(users)
      .values([
        {
          lineUserId: "application-hourly-wage-rules-race-admin",
          displayName: "競合管理者",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "application-hourly-wage-rules-race-staff",
          displayName: "競合スタッフ",
          role: "staff",
          status: "active",
        },
      ])
      .returning({ id: users.id });
    const application = createHourlyWageRuleManagementApplication({
      db: database.db,
      userReferences: testUserReferences(database.db),
    });
    const created = await application.createHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1200,
      effectiveFrom: "2026-08-01",
    });
    assert.equal(created.kind, "success");
    if (created.kind !== "success") throw new Error("Expected created rules.");
    const first = created.hourlyWageRule;
    const second = await application.createHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-08-01",
    });
    assert.equal(second.kind, "success");
    if (second.kind !== "success") throw new Error("Expected created rules.");

    const triggerId = `hourly_race_${staffId.replaceAll("-", "")}`;
    // cspell:ignore plpgsql
    await database.pool.query(
      `CREATE FUNCTION ${triggerId}_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${triggerId}_trigger BEFORE UPDATE ON hourly_wage_rules FOR EACH ROW WHEN (OLD.user_id = '${staffId}') EXECUTE FUNCTION ${triggerId}_delay()`,
    );

    const individualUpdate = application.updateHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRuleId: first.id,
      expectedVersion: first.version,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1400,
      effectiveFrom: "2026-08-01",
    });
    const updateDeadline = Date.now() + 3_000;
    let individualUpdateRunning = false;
    while (Date.now() < updateDeadline) {
      const { rows } = await database.pool.query<{ active: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query ILIKE '%update%hourly_wage_rules%') AS active`,
      );
      if (rows[0]?.active) {
        individualUpdateRunning = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      individualUpdateRunning,
      true,
      "individual UPDATE reached the database",
    );
    const bulkUpdate = application.bulkUpdateHourlyWageRules({
      actorUserId: adminId,
      userId: staffId,
      effectiveFrom: "2026-08-01",
      changes: [
        {
          dayType: "mon",
          workPeriod: "day",
          hourlyWage: 1500,
          expectedBaseline: { id: first.id, version: first.version },
        },
        {
          dayType: "mon",
          workPeriod: "night",
          hourlyWage: 1600,
          expectedBaseline: {
            id: second.hourlyWageRule.id,
            version: second.hourlyWageRule.version,
          },
        },
      ],
    });
    const [individualResult, bulkResult] = await Promise.all([
      individualUpdate,
      bulkUpdate,
    ]);
    assert.equal(individualResult.kind, "success");
    assert.deepEqual(bulkResult, { kind: "bulk-conflict" });
    assert.deepEqual(
      await database.db
        .select({
          dayType: hourlyWageRules.dayType,
          workPeriod: hourlyWageRules.workPeriod,
          hourlyWage: hourlyWageRules.hourlyWage,
          version: hourlyWageRules.version,
        })
        .from(hourlyWageRules)
        .where(eq(hourlyWageRules.userId, staffId))
        .orderBy(asc(hourlyWageRules.workPeriod)),
      [
        { dayType: "mon", workPeriod: "day", hourlyWage: 1400, version: 2 },
        { dayType: "mon", workPeriod: "night", hourlyWage: 1300, version: 1 },
      ],
    );
  } finally {
    await database.close();
  }
});

test("実DBの現在roleで管理者自身とスタッフだけ時給変更を許可する", async () => {
  const database = await startMediumTestDatabase();
  try {
    const [
      { id: otherAdminId },
      { id: targetAdminId },
      { id: promotedUserId },
    ] = await database.db
      .insert(users)
      .values([
        {
          lineUserId: "application-hourly-wage-rules-auth-other",
          displayName: "時給認可別管理者",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "application-hourly-wage-rules-auth-target",
          displayName: "時給認可対象管理者",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "application-hourly-wage-rules-auth-promoted",
          displayName: "時給認可昇格対象",
          role: "staff",
          status: "active",
        },
      ])
      .returning({ id: users.id });
    const application = createHourlyWageRuleManagementApplication({
      db: database.db,
      userReferences: testUserReferences(database.db),
    });
    const targetInput = {
      actorUserId: otherAdminId,
      userId: targetAdminId,
      workPeriod: "day" as const,
      dayType: "mon" as const,
      hourlyWage: 1200,
      effectiveFrom: "2026-08-01",
    };

    assert.deepEqual(await application.createHourlyWageRule(targetInput), {
      kind: "role-forbidden",
    });
    assert.deepEqual(
      await application.getHourlyWageRules({
        actorUserId: targetAdminId,
        userId: targetAdminId,
      }),
      {
        kind: "success",
        hourlyWageRules: [],
      },
    );
    const created = await application.createHourlyWageRule({
      ...targetInput,
      actorUserId: targetAdminId,
    });
    assert.equal(created.kind, "success");
    if (created.kind !== "success") throw new Error("Expected created rules.");
    const originalRules = created.hourlyWageRule;
    const updateInput = {
      ...targetInput,
      hourlyWageRuleId: originalRules.id,
      expectedVersion: originalRules.version,
      workPeriod: "night" as const,
      dayType: "holiday" as const,
      hourlyWage: 1800,
      effectiveFrom: "2027-01-01",
    };
    assert.deepEqual(await application.updateHourlyWageRule(updateInput), {
      kind: "role-forbidden",
    });
    assert.deepEqual(
      await application.deleteHourlyWageRule({
        ...targetInput,
        hourlyWageRuleId: originalRules.id,
        expectedVersion: originalRules.version,
      }),
      { kind: "role-forbidden" },
    );
    assert.deepEqual(
      await database.db
        .select({
          hourlyWage: hourlyWageRules.hourlyWage,
          version: hourlyWageRules.version,
        })
        .from(hourlyWageRules)
        .where(eq(hourlyWageRules.id, originalRules.id)),
      [{ hourlyWage: 1200, version: 1 }],
    );
    const listed = await application.getHourlyWageRules({
      actorUserId: targetAdminId,
      userId: targetAdminId,
    });
    assert.equal(listed.kind, "success");
    if (listed.kind !== "success") throw new Error("Expected listed rules.");
    assert.deepEqual(listed.hourlyWageRules, [originalRules]);
    const updated = await application.updateHourlyWageRule({
      ...updateInput,
      actorUserId: targetAdminId,
    });
    assert.equal(updated.kind, "success");
    assert.deepEqual(
      await application.deleteHourlyWageRule({
        ...targetInput,
        actorUserId: targetAdminId,
        hourlyWageRuleId: originalRules.id,
        expectedVersion: 2,
      }),
      { kind: "success", hourlyWageRuleId: originalRules.id },
    );

    const promotedRules = await application.createHourlyWageRule({
      ...targetInput,
      actorUserId: otherAdminId,
      userId: promotedUserId,
      effectiveFrom: "2026-09-01",
    });
    assert.equal(promotedRules.kind, "success");
    if (promotedRules.kind !== "success")
      throw new Error("Expected promoted user's rules.");
    await database.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, promotedUserId));
    const promotedUpdate = {
      actorUserId: otherAdminId,
      userId: promotedUserId,
      hourlyWageRuleId: promotedRules.hourlyWageRule.id,
      expectedVersion: promotedRules.hourlyWageRule.version,
      workPeriod: "night" as const,
      dayType: "holiday" as const,
      hourlyWage: 1800,
      effectiveFrom: "2027-01-01",
    };
    assert.deepEqual(await application.updateHourlyWageRule(promotedUpdate), {
      kind: "role-forbidden",
    });
    assert.deepEqual(await application.deleteHourlyWageRule(promotedUpdate), {
      kind: "role-forbidden",
    });
    assert.deepEqual(
      await database.db
        .select({
          hourlyWage: hourlyWageRules.hourlyWage,
          version: hourlyWageRules.version,
        })
        .from(hourlyWageRules)
        .where(eq(hourlyWageRules.id, promotedRules.hourlyWageRule.id)),
      [{ hourlyWage: 1200, version: 1 }],
    );
    assert.equal(
      (
        await application.updateHourlyWageRule({
          ...promotedUpdate,
          actorUserId: promotedUserId,
        })
      ).kind,
      "success",
    );
  } finally {
    await database.close();
  }
});

test("時給は業務上限まで保存でき、上限超過はDB制約で拒否される", async () => {
  const database = await startMediumTestDatabase();
  try {
    const [{ id: staffId }] = await database.db
      .insert(users)
      .values({
        lineUserId: "application-hourly-wage-rules-range-staff",
        displayName: "時給範囲スタッフ",
        role: "staff",
        status: "active",
      })
      .returning({ id: users.id });
    assert.ok(staffId);

    await database.db.insert(hourlyWageRules).values({
      userId: staffId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: MAX_HOURLY_WAGE,
      effectiveFrom: "2026-08-01",
    });
    await assert.rejects(
      database.db.insert(hourlyWageRules).values({
        userId: staffId,
        workPeriod: "day",
        dayType: "tue",
        hourlyWage: MAX_HOURLY_WAGE + 1,
        effectiveFrom: "2026-08-01",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.cause instanceof Error);
        assert.match(
          error.cause.message,
          /hourly_wage_rules_hourly_wage_range_check/,
        );
        return true;
      },
    );
  } finally {
    await database.close();
  }
});

test("時給bulkはexact updateとinsertを原子的に保存し、stale baselineなら全件rollbackする", async () => {
  const database = await startMediumTestDatabase();
  const application = createHourlyWageRuleManagementApplication({
    db: database.db,
    userReferences: testUserReferences(database.db),
  });
  try {
    const suffix = crypto.randomUUID();
    const [{ id: adminId }] = await database.db
      .insert(users)
      .values({
        lineUserId: `bulk-admin-${suffix}`,
        displayName: "管理者",
        role: "admin",
        status: "active",
      })
      .returning({ id: users.id });
    const [{ id: staffId }] = await database.db
      .insert(users)
      .values({
        lineUserId: `bulk-staff-${suffix}`,
        displayName: "スタッフ",
        role: "staff",
        status: "active",
      })
      .returning({ id: users.id });
    const [existing] = await database.db
      .insert(hourlyWageRules)
      .values({
        userId: staffId,
        dayType: "mon",
        workPeriod: "day",
        hourlyWage: 1200,
        effectiveFrom: "2026-01-01",
      })
      .returning();
    const existingRules = existing;
    assert.ok(existingRules);
    const [exactRules, futureRules] = await database.db
      .insert(hourlyWageRules)
      .values([
        {
          userId: staffId,
          dayType: "mon",
          workPeriod: "day",
          hourlyWage: 1250,
          effectiveFrom: "2026-06-01",
        },
        {
          userId: staffId,
          dayType: "mon",
          workPeriod: "day",
          hourlyWage: 1800,
          effectiveFrom: "2027-01-01",
        },
      ])
      .returning();
    assert.ok(exactRules);
    assert.ok(futureRules);
    const request = {
      actorUserId: adminId,
      userId: staffId,
      effectiveFrom: "2026-06-01",
      changes: [
        {
          dayType: "mon" as const,
          workPeriod: "day" as const,
          hourlyWage: 1300,
          expectedBaseline: { id: exactRules.id, version: exactRules.version },
        },
        {
          dayType: "tue" as const,
          workPeriod: "night" as const,
          hourlyWage: 1500,
          expectedBaseline: null,
        },
      ],
    };
    assert.equal(
      (await application.bulkUpdateHourlyWageRules(request)).kind,
      "success",
    );
    const saved = await database.db
      .select()
      .from(hourlyWageRules)
      .where(eq(hourlyWageRules.userId, staffId));
    assert.equal(saved.length, 4);
    assert.equal(
      saved.find((row) => row.id === existingRules.id)?.effectiveFrom,
      "2026-01-01",
    );
    const exactUpdated = saved.find((row) => row.id === exactRules.id);
    assert.equal(exactUpdated?.hourlyWage, 1300);
    assert.equal(exactUpdated?.version, exactRules.version + 1);
    assert.equal(exactUpdated?.effectiveFrom, "2026-06-01");
    const retainedFuture = saved.find((row) => row.id === futureRules.id);
    assert.equal(retainedFuture?.hourlyWage, 1800);
    assert.equal(retainedFuture?.version, futureRules.version);
    const stale = await application.bulkUpdateHourlyWageRules({
      ...request,
      effectiveFrom: "2026-08-01",
      changes: [
        { ...request.changes[0], hourlyWage: 1800 },
        { ...request.changes[1], hourlyWage: 1900 },
      ],
    });
    assert.deepEqual(stale, { kind: "bulk-conflict" });
    assert.equal(
      (
        await database.db
          .select()
          .from(hourlyWageRules)
          .where(eq(hourlyWageRules.userId, staffId))
      ).length,
      4,
    );
  } finally {
    await database.close();
  }
});

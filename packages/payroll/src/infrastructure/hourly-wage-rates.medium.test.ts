import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresDatabase } from "@repo/platform";
import { authSessions, users } from "@repo/users/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

import { createHourlyWageRateManagementApplication as createApplication } from "../application/hourly-wage-rates.ts";
import type { PayrollUserReferenceReader } from "../application/user-reference.ts";
import { hourlyWageRates } from "../schema/hourly-wage-rates.ts";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";
import { PostgresHourlyWageRatePersistenceAdapter } from "./postgres-hourly-wage-rate-persistence-adapter.ts";

function createHourlyWageRateManagementApplication(dependencies: {
  db: PostgresDatabase;
  userReferences: PayrollUserReferenceReader;
}) {
  return createApplication({
    userReferences: dependencies.userReferences,
    hourlyWageRatePersistence: new PostgresHourlyWageRatePersistenceAdapter(
      dependencies.db,
    ),
  });
}

function testUserReferences(db: PostgresDatabase): PayrollUserReferenceReader {
  return {
    async getUserById(userId) {
      const [row] = await db
        .select({
          userId: users.id,
          role: users.role,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.id, userId));
      return row ? { ...row, role: row.role as "staff" | "admin" } : null;
    },
  };
}

test("default時給CRUDはunique conflictを結果化し、確定済み時給を変更しない", async () => {
  const database = await startMediumTestDatabase();
  const application = createHourlyWageRateManagementApplication({
    db: database.db,
    userReferences: testUserReferences(database.db),
  });
  try {
    const [{ id: adminId }] = await database.db
      .insert(users)
      .values({
        lineUserId: "application-rate-admin",
        displayName: "時給管理者",
        role: "admin",
        status: "active",
      })
      .returning({ id: users.id });
    const [{ id: staffId }] = await database.db
      .insert(users)
      .values({
        lineUserId: "application-rate-staff",
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
    const created = await application.createHourlyWageRate(input);
    assert.equal(created.kind, "success");
    assert.deepEqual(await application.createHourlyWageRate(input), {
      kind: "already-exists",
    });
    if (created.kind !== "success") throw new Error("Expected created rate.");
    assert.equal(created.hourlyWageRate.version, 1);
    assert.deepEqual(await application.getHourlyWageRates(staffId), {
      kind: "success",
      hourlyWageRates: [created.hourlyWageRate],
    });
    const updated = await application.updateHourlyWageRate({
      ...input,
      hourlyWageRateId: created.hourlyWageRate.id,
      expectedVersion: created.hourlyWageRate.version,
      workPeriod: "night",
      dayType: "holiday",
      hourlyWage: 1800,
      effectiveFrom: "2027-01-01",
    });
    assert.equal(updated.kind, "success");
    if (updated.kind !== "success") throw new Error("Expected updated rate.");
    assert.equal(updated.hourlyWageRate.version, 2);
    const staleUpdate = await application.updateHourlyWageRate({
      ...input,
      hourlyWageRateId: created.hourlyWageRate.id,
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
          workPeriod: hourlyWageRates.workPeriod,
          dayType: hourlyWageRates.dayType,
          hourlyWage: hourlyWageRates.hourlyWage,
          effectiveFrom: hourlyWageRates.effectiveFrom,
          version: hourlyWageRates.version,
        })
        .from(hourlyWageRates)
        .where(eq(hourlyWageRates.id, created.hourlyWageRate.id)),
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
      await application.deleteHourlyWageRate({
        actorUserId: adminId,
        userId: staffId,
        hourlyWageRateId: created.hourlyWageRate.id,
        expectedVersion: 1,
      }),
      { kind: "version-conflict" },
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(hourlyWageRates)
          .where(eq(hourlyWageRates.id, created.hourlyWageRate.id))
      ).length,
      1,
    );
    assert.deepEqual(
      await application.deleteHourlyWageRate({
        actorUserId: adminId,
        userId: staffId,
        hourlyWageRateId: created.hourlyWageRate.id,
        expectedVersion: 2,
      }),
      { kind: "success", hourlyWageRateId: created.hourlyWageRate.id },
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(hourlyWageRates)
          .where(eq(hourlyWageRates.id, created.hourlyWageRate.id))
      ).length,
      0,
    );
    assert.deepEqual(
      await application.deleteHourlyWageRate({
        actorUserId: adminId,
        userId: staffId,
        hourlyWageRateId: created.hourlyWageRate.id,
        expectedVersion: 2,
      }),
      { kind: "rate-not-found" },
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

test("個別更新と重なる一括更新は最新baselineで競合し、部分保存しない", async () => {
  const database = await startMediumTestDatabase();
  try {
    const [{ id: adminId }, { id: staffId }] = await database.db
      .insert(users)
      .values([
        {
          lineUserId: "application-rate-race-admin",
          displayName: "競合管理者",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "application-rate-race-staff",
          displayName: "競合スタッフ",
          role: "staff",
          status: "active",
        },
      ])
      .returning({ id: users.id });
    const application = createHourlyWageRateManagementApplication({
      db: database.db,
      userReferences: testUserReferences(database.db),
    });
    const created = await application.createHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1200,
      effectiveFrom: "2026-08-01",
    });
    assert.equal(created.kind, "success");
    if (created.kind !== "success") throw new Error("Expected created rate.");
    const first = created.hourlyWageRate;
    const second = await application.createHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-08-01",
    });
    assert.equal(second.kind, "success");
    if (second.kind !== "success") throw new Error("Expected created rate.");

    const triggerId = `hourly_race_${staffId.replaceAll("-", "")}`;
    // cspell:ignore plpgsql
    await database.pool.query(
      `CREATE FUNCTION ${triggerId}_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$`,
    );
    await database.pool.query(
      `CREATE TRIGGER ${triggerId}_trigger BEFORE UPDATE ON hourly_wage_rates FOR EACH ROW WHEN (OLD.user_id = '${staffId}') EXECUTE FUNCTION ${triggerId}_delay()`,
    );

    const individualUpdate = application.updateHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRateId: first.id,
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
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query ILIKE '%update%hourly_wage_rates%') AS active`,
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
    const bulkUpdate = application.bulkUpdateHourlyWageRates({
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
            id: second.hourlyWageRate.id,
            version: second.hourlyWageRate.version,
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
          dayType: hourlyWageRates.dayType,
          workPeriod: hourlyWageRates.workPeriod,
          hourlyWage: hourlyWageRates.hourlyWage,
          version: hourlyWageRates.version,
        })
        .from(hourlyWageRates)
        .where(eq(hourlyWageRates.userId, staffId))
        .orderBy(asc(hourlyWageRates.workPeriod)),
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
          lineUserId: "application-rate-auth-other",
          displayName: "時給認可別管理者",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "application-rate-auth-target",
          displayName: "時給認可対象管理者",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "application-rate-auth-promoted",
          displayName: "時給認可昇格対象",
          role: "staff",
          status: "active",
        },
      ])
      .returning({ id: users.id });
    const application = createHourlyWageRateManagementApplication({
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

    assert.deepEqual(await application.createHourlyWageRate(targetInput), {
      kind: "role-forbidden",
    });
    assert.deepEqual(await application.getHourlyWageRates(targetAdminId), {
      kind: "success",
      hourlyWageRates: [],
    });
    const created = await application.createHourlyWageRate({
      ...targetInput,
      actorUserId: targetAdminId,
    });
    assert.equal(created.kind, "success");
    if (created.kind !== "success") throw new Error("Expected created rate.");
    const originalRate = created.hourlyWageRate;
    const updateInput = {
      ...targetInput,
      hourlyWageRateId: originalRate.id,
      expectedVersion: originalRate.version,
      workPeriod: "night" as const,
      dayType: "holiday" as const,
      hourlyWage: 1800,
      effectiveFrom: "2027-01-01",
    };
    assert.deepEqual(await application.updateHourlyWageRate(updateInput), {
      kind: "role-forbidden",
    });
    assert.deepEqual(
      await application.deleteHourlyWageRate({
        ...targetInput,
        hourlyWageRateId: originalRate.id,
        expectedVersion: originalRate.version,
      }),
      { kind: "role-forbidden" },
    );
    assert.deepEqual(
      await database.db
        .select({
          hourlyWage: hourlyWageRates.hourlyWage,
          version: hourlyWageRates.version,
        })
        .from(hourlyWageRates)
        .where(eq(hourlyWageRates.id, originalRate.id)),
      [{ hourlyWage: 1200, version: 1 }],
    );
    const listed = await application.getHourlyWageRates(targetAdminId);
    assert.equal(listed.kind, "success");
    if (listed.kind !== "success") throw new Error("Expected listed rates.");
    assert.deepEqual(listed.hourlyWageRates, [originalRate]);
    const updated = await application.updateHourlyWageRate({
      ...updateInput,
      actorUserId: targetAdminId,
    });
    assert.equal(updated.kind, "success");
    assert.deepEqual(
      await application.deleteHourlyWageRate({
        ...targetInput,
        actorUserId: targetAdminId,
        hourlyWageRateId: originalRate.id,
        expectedVersion: 2,
      }),
      { kind: "success", hourlyWageRateId: originalRate.id },
    );

    const promotedRate = await application.createHourlyWageRate({
      ...targetInput,
      actorUserId: otherAdminId,
      userId: promotedUserId,
      effectiveFrom: "2026-09-01",
    });
    assert.equal(promotedRate.kind, "success");
    if (promotedRate.kind !== "success")
      throw new Error("Expected promoted user's rate.");
    await database.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, promotedUserId));
    const promotedUpdate = {
      actorUserId: otherAdminId,
      userId: promotedUserId,
      hourlyWageRateId: promotedRate.hourlyWageRate.id,
      expectedVersion: promotedRate.hourlyWageRate.version,
      workPeriod: "night" as const,
      dayType: "holiday" as const,
      hourlyWage: 1800,
      effectiveFrom: "2027-01-01",
    };
    assert.deepEqual(await application.updateHourlyWageRate(promotedUpdate), {
      kind: "role-forbidden",
    });
    assert.deepEqual(await application.deleteHourlyWageRate(promotedUpdate), {
      kind: "role-forbidden",
    });
    assert.deepEqual(
      await database.db
        .select({
          hourlyWage: hourlyWageRates.hourlyWage,
          version: hourlyWageRates.version,
        })
        .from(hourlyWageRates)
        .where(eq(hourlyWageRates.id, promotedRate.hourlyWageRate.id)),
      [{ hourlyWage: 1200, version: 1 }],
    );
    assert.equal(
      (
        await application.updateHourlyWageRate({
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
        lineUserId: "application-rate-range-staff",
        displayName: "時給範囲スタッフ",
        role: "staff",
        status: "active",
      })
      .returning({ id: users.id });
    assert.ok(staffId);

    await database.db.insert(hourlyWageRates).values({
      userId: staffId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 99_999,
      effectiveFrom: "2026-08-01",
    });
    await assert.rejects(
      database.db.insert(hourlyWageRates).values({
        userId: staffId,
        workPeriod: "day",
        dayType: "tue",
        hourlyWage: 100_000,
        effectiveFrom: "2026-08-01",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.cause instanceof Error);
        assert.match(
          error.cause.message,
          /hourly_wage_rates_hourly_wage_range_check/,
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
  const application = createHourlyWageRateManagementApplication({
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
      .insert(hourlyWageRates)
      .values({
        userId: staffId,
        dayType: "mon",
        workPeriod: "day",
        hourlyWage: 1200,
        effectiveFrom: "2026-01-01",
      })
      .returning();
    const existingRate = existing;
    assert.ok(existingRate);
    const [exactRate, futureRate] = await database.db
      .insert(hourlyWageRates)
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
    assert.ok(exactRate);
    assert.ok(futureRate);
    const request = {
      actorUserId: adminId,
      userId: staffId,
      effectiveFrom: "2026-06-01",
      changes: [
        {
          dayType: "mon" as const,
          workPeriod: "day" as const,
          hourlyWage: 1300,
          expectedBaseline: { id: exactRate.id, version: exactRate.version },
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
      (await application.bulkUpdateHourlyWageRates(request)).kind,
      "success",
    );
    const saved = await database.db
      .select()
      .from(hourlyWageRates)
      .where(eq(hourlyWageRates.userId, staffId));
    assert.equal(saved.length, 4);
    assert.equal(
      saved.find((row) => row.id === existingRate.id)?.effectiveFrom,
      "2026-01-01",
    );
    const exactUpdated = saved.find((row) => row.id === exactRate.id);
    assert.equal(exactUpdated?.hourlyWage, 1300);
    assert.equal(exactUpdated?.version, exactRate.version + 1);
    assert.equal(exactUpdated?.effectiveFrom, "2026-06-01");
    const retainedFuture = saved.find((row) => row.id === futureRate.id);
    assert.equal(retainedFuture?.hourlyWage, 1800);
    assert.equal(retainedFuture?.version, futureRate.version);
    const stale = await application.bulkUpdateHourlyWageRates({
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
          .from(hourlyWageRates)
          .where(eq(hourlyWageRates.userId, staffId))
      ).length,
      4,
    );
  } finally {
    await database.close();
  }
});

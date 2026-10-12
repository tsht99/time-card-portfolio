import assert from "node:assert/strict";
import test from "node:test";
import { users } from "@repo/users/schema";
import { hourlyWageRules } from "../schema/hourly-wage-rules.ts";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";
import { PostgresHourlyWageRuleReadStore } from "./postgres-hourly-wage-rule-read-store.ts";

test("payroll read returns only each target bucket baseline and in-period changes", async () => {
  const database = await startMediumTestDatabase();
  try {
    const [{ id: targetUserId }] = await database.db
      .insert(users)
      .values({
        lineUserId: "payroll-read-target",
        displayName: "給与対象",
        role: "staff",
        status: "active",
      })
      .returning({ id: users.id });
    const [{ id: otherUserId }] = await database.db
      .insert(users)
      .values({
        lineUserId: "payroll-read-other",
        displayName: "対象外",
        role: "staff",
        status: "active",
      })
      .returning({ id: users.id });

    await database.db.insert(hourlyWageRules).values([
      {
        userId: targetUserId,
        workPeriod: "day",
        dayType: "mon",
        hourlyWage: 1000,
        effectiveFrom: "2025-01-01",
      },
      {
        userId: targetUserId,
        workPeriod: "day",
        dayType: "mon",
        hourlyWage: 1100,
        effectiveFrom: "2026-01-01",
      },
      {
        userId: targetUserId,
        workPeriod: "day",
        dayType: "mon",
        hourlyWage: 1200,
        effectiveFrom: "2026-05-10",
      },
      {
        userId: targetUserId,
        workPeriod: "day",
        dayType: "mon",
        hourlyWage: 1300,
        effectiveFrom: "2026-06-01",
      },
      {
        userId: targetUserId,
        workPeriod: "night",
        dayType: "holiday",
        hourlyWage: 1400,
        effectiveFrom: "2025-03-01",
      },
      {
        userId: targetUserId,
        workPeriod: "night",
        dayType: "holiday",
        hourlyWage: 1500,
        effectiveFrom: "2026-05-20",
      },
      {
        userId: otherUserId,
        workPeriod: "day",
        dayType: "mon",
        hourlyWage: 1600,
        effectiveFrom: "2026-01-01",
      },
    ]);

    const store = new PostgresHourlyWageRuleReadStore(database.db);
    assert.deepEqual(
      await store.findForPayrollEstimate({
        userIds: [targetUserId],
        startAttendanceDateInclusive: "2026-05-01",
        endAttendanceDateInclusive: "2026-05-31",
      }),
      [
        {
          userId: targetUserId,
          workPeriod: "day",
          dayType: "mon",
          hourlyWage: 1100,
          effectiveFrom: "2026-01-01",
        },
        {
          userId: targetUserId,
          workPeriod: "day",
          dayType: "mon",
          hourlyWage: 1200,
          effectiveFrom: "2026-05-10",
        },
        {
          userId: targetUserId,
          workPeriod: "night",
          dayType: "holiday",
          hourlyWage: 1400,
          effectiveFrom: "2025-03-01",
        },
        {
          userId: targetUserId,
          workPeriod: "night",
          dayType: "holiday",
          hourlyWage: 1500,
          effectiveFrom: "2026-05-20",
        },
      ],
    );
    assert.deepEqual(
      await store.findForPayrollEstimate({
        userIds: [],
        startAttendanceDateInclusive: "2026-05-01",
        endAttendanceDateInclusive: "2026-05-31",
      }),
      [],
    );
  } finally {
    await database.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  bulkUpdateHourlyWageRulesRequestSchema,
  createHourlyWageRuleRequestSchema,
} from "@repo/contracts";
import { MAX_HOURLY_WAGE } from "@repo/payroll";

const baseline = { id: "33333333-3333-4333-8333-333333333333", version: 2 };
const change = {
  dayType: "mon" as const,
  workPeriod: "day" as const,
  hourlyWage: 0,
  expectedBaseline: baseline,
};

test("create request preserves wage validation values and error message", () => {
  const base = {
    workPeriod: "day",
    dayType: "mon",
    effectiveFrom: "2026-09-25",
  };
  for (const hourlyWage of [0, MAX_HOURLY_WAGE]) {
    assert.equal(
      createHourlyWageRuleRequestSchema.safeParse({ ...base, hourlyWage })
        .success,
      true,
    );
  }
  for (const hourlyWage of [-1, MAX_HOURLY_WAGE + 1, 1200.5]) {
    const result = createHourlyWageRuleRequestSchema.safeParse({
      ...base,
      hourlyWage,
    });
    assert.equal(result.success, false);
    if (!result.success)
      assert.equal(
        result.error.issues[0]?.message,
        "hourlyWage は0以上99,999以下の整数で指定してください。",
      );
  }
});

test("accepts multiple cells and zero wages", () => {
  assert.equal(
    bulkUpdateHourlyWageRulesRequestSchema.safeParse({
      effectiveFrom: "2026-09-25",
      changes: [change, { ...change, dayType: "tue" }],
    }).success,
    true,
  );
});
test("rejects invalid date, wage, excessive entries, duplicate cells and malformed baseline", () => {
  const valid = { effectiveFrom: "2026-09-25", changes: [change] };
  const dayTypes = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
    "holiday",
  ] as const;
  const tooMany = Array.from({ length: 17 }, (_, i) => ({
    ...change,
    dayType: dayTypes[i % 8] ?? "mon",
    workPeriod: i < 8 ? "day" : "night",
  }));
  for (const input of [
    { ...valid, effectiveFrom: "2026-02-30" },
    { ...valid, changes: [{ ...change, hourlyWage: 100000 }] },
    { ...valid, changes: tooMany },
    { ...valid, changes: [change, change] },
    {
      ...valid,
      changes: [{ ...change, expectedBaseline: { id: "bad", version: 0 } }],
    },
  ])
    assert.equal(
      bulkUpdateHourlyWageRulesRequestSchema.safeParse(input).success,
      false,
    );
});

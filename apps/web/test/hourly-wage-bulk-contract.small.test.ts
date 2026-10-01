import {
  bulkUpdateHourlyWageRatesRequestSchema,
  createHourlyWageRateRequestSchema,
} from "@repo/payroll/contracts";
import { describe, expect, test } from "vitest";

const baseline = { id: "33333333-3333-4333-8333-333333333333", version: 2 };
const change = {
  dayType: "mon" as const,
  workPeriod: "day" as const,
  hourlyWage: 0,
  expectedBaseline: baseline,
};

describe("bulk hourly wage request contract", () => {
  test("create request preserves wage validation values and error message", () => {
    const base = {
      workPeriod: "day",
      dayType: "mon",
      effectiveFrom: "2026-09-25",
    };
    for (const hourlyWage of [0, 99_999]) {
      expect(
        createHourlyWageRateRequestSchema.safeParse({ ...base, hourlyWage })
          .success,
      ).toBe(true);
    }
    for (const hourlyWage of [-1, 100_000, 1200.5]) {
      const result = createHourlyWageRateRequestSchema.safeParse({
        ...base,
        hourlyWage,
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues[0]?.message).toBe(
          "hourlyWage は0以上99,999以下の整数で指定してください。",
        );
    }
  });

  test("accepts multiple cells and zero wages", () => {
    expect(
      bulkUpdateHourlyWageRatesRequestSchema.safeParse({
        effectiveFrom: "2026-09-25",
        changes: [change, { ...change, dayType: "tue" }],
      }).success,
    ).toBe(true);
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
      expect(
        bulkUpdateHourlyWageRatesRequestSchema.safeParse(input).success,
      ).toBe(false);
  });
});

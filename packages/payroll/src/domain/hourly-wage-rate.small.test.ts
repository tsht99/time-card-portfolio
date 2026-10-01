import assert from "node:assert/strict";
import test from "node:test";

import {
  findApplicableHourlyWageRate,
  type HourlyWageRate,
  isValidHourlyWage,
} from "./hourly-wage-rate.ts";

const selection = {
  userId: "user-1",
  workPeriod: "day" as const,
  dayType: "mon" as const,
  attendanceDate: "2026-04-01",
};

function rate(overrides: Partial<HourlyWageRate> = {}): HourlyWageRate {
  return {
    userId: "user-1",
    workPeriod: "day",
    dayType: "mon",
    hourlyWage: 1200,
    effectiveFrom: "2026-01-01",
    ...overrides,
  };
}

test("effectiveFrom当日はそのルールが適用される", () => {
  const applicableRate = rate({ effectiveFrom: selection.attendanceDate });

  assert.equal(
    findApplicableHourlyWageRate([applicableRate], selection),
    applicableRate,
  );
});

test("複数履歴では最新の有効ルールを選ぶ", () => {
  const latestRate = rate({ effectiveFrom: "2026-03-01", hourlyWage: 1400 });

  assert.equal(
    findApplicableHourlyWageRate(
      [
        rate({ effectiveFrom: "2026-01-01" }),
        latestRate,
        rate({ effectiveFrom: "2026-02-01" }),
      ],
      selection,
    ),
    latestRate,
  );
});

test("将来開始のルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRate(
      [rate({ effectiveFrom: "2026-04-02" })],
      selection,
    ),
    null,
  );
});

test("userIdが異なるルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRate([rate({ userId: "user-2" })], selection),
    null,
  );
});

test("workPeriodが異なるルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRate([rate({ workPeriod: "night" })], selection),
    null,
  );
});

test("dayTypeが異なるルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRate([rate({ dayType: "sun" })], selection),
    null,
  );
});

test("適用可能なルールがなければnullを返す", () => {
  assert.equal(findApplicableHourlyWageRate([], selection), null);
});

test("holidayは通常のdayTypeと独立して選択できる", () => {
  const holidayRate = rate({ dayType: "holiday", hourlyWage: 1600 });

  assert.equal(
    findApplicableHourlyWageRate([rate(), holidayRate], {
      ...selection,
      dayType: "holiday",
    }),
    holidayRate,
  );
});

test("時給は0以上99,999以下の整数だけを有効とする", () => {
  assert.equal(isValidHourlyWage(-1), false);
  assert.equal(isValidHourlyWage(0), true);
  assert.equal(isValidHourlyWage(99_999), true);
  assert.equal(isValidHourlyWage(100_000), false);
  assert.equal(isValidHourlyWage(1.5), false);
});

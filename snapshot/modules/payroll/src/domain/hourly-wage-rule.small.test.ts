import assert from "node:assert/strict";
import test from "node:test";

import {
  findApplicableHourlyWageRule,
  type HourlyWageRule,
  isValidHourlyWage,
  MAX_HOURLY_WAGE,
} from "./hourly-wage-rule.ts";

const selection = {
  userId: "user-1",
  workPeriod: "day" as const,
  dayType: "mon" as const,
  attendanceDate: "2026-04-01",
};

function rule(overrides: Partial<HourlyWageRule> = {}): HourlyWageRule {
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
  const applicableRules = rule({ effectiveFrom: selection.attendanceDate });

  assert.equal(
    findApplicableHourlyWageRule([applicableRules], selection),
    applicableRules,
  );
});

test("複数履歴では最新の有効ルールを選ぶ", () => {
  const latestRules = rule({ effectiveFrom: "2026-03-01", hourlyWage: 1400 });

  assert.equal(
    findApplicableHourlyWageRule(
      [
        rule({ effectiveFrom: "2026-01-01" }),
        latestRules,
        rule({ effectiveFrom: "2026-02-01" }),
      ],
      selection,
    ),
    latestRules,
  );
});

test("将来開始のルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRule(
      [rule({ effectiveFrom: "2026-04-02" })],
      selection,
    ),
    null,
  );
});

test("userIdが異なるルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRule([rule({ userId: "user-2" })], selection),
    null,
  );
});

test("workPeriodが異なるルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRule([rule({ workPeriod: "night" })], selection),
    null,
  );
});

test("dayTypeが異なるルールは選ばない", () => {
  assert.equal(
    findApplicableHourlyWageRule([rule({ dayType: "sun" })], selection),
    null,
  );
});

test("適用可能なルールがなければnullを返す", () => {
  assert.equal(findApplicableHourlyWageRule([], selection), null);
});

test("holidayは通常のdayTypeと独立して選択できる", () => {
  const holidayRules = rule({ dayType: "holiday", hourlyWage: 1600 });

  assert.equal(
    findApplicableHourlyWageRule([rule(), holidayRules], {
      ...selection,
      dayType: "holiday",
    }),
    holidayRules,
  );
});

test("時給は0以上99,999以下の整数だけを有効とする", () => {
  assert.equal(MAX_HOURLY_WAGE, 99_999);
  assert.equal(isValidHourlyWage(-1), false);
  assert.equal(isValidHourlyWage(0), true);
  assert.equal(isValidHourlyWage(MAX_HOURLY_WAGE), true);
  assert.equal(isValidHourlyWage(MAX_HOURLY_WAGE + 1), false);
  assert.equal(isValidHourlyWage(1.5), false);
});

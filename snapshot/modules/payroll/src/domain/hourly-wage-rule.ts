export const workPeriods = ["day", "night"] as const;
export type WorkPeriod = (typeof workPeriods)[number];

export const hourlyWageDayTypes = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "holiday",
] as const;

export type HourlyWageDayType = (typeof hourlyWageDayTypes)[number];

export const MAX_HOURLY_WAGE = 99_999;

/** 給与見込みコンテキストの業務ルールとして時給額の有効範囲を一元管理する。 */
export function isValidHourlyWage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_HOURLY_WAGE
  );
}

export function isValidAttendanceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export type HourlyWageRule = {
  userId: string;
  workPeriod: WorkPeriod;
  dayType: HourlyWageDayType;
  hourlyWage: number;
  effectiveFrom: string;
};

export type HourlyWageRuleSelection = {
  userId: string;
  workPeriod: WorkPeriod;
  dayType: HourlyWageDayType;
  attendanceDate: string;
};

export function findApplicableHourlyWageRule<TRule extends HourlyWageRule>(
  rules: readonly TRule[],
  selection: HourlyWageRuleSelection,
): TRule | null {
  return rules.reduce<TRule | null>((selectedRule, rule) => {
    if (
      rule.userId !== selection.userId ||
      rule.workPeriod !== selection.workPeriod ||
      rule.dayType !== selection.dayType ||
      rule.effectiveFrom > selection.attendanceDate
    ) {
      return selectedRule;
    }

    if (
      selectedRule === null ||
      rule.effectiveFrom > selectedRule.effectiveFrom
    ) {
      return rule;
    }

    return selectedRule;
  }, null);
}

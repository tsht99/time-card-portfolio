import type { HourlyWageRuleResponse } from "@repo/contracts";

export type HourlyWageRule = HourlyWageRuleResponse;

export const dayTypeLabels: Record<HourlyWageRule["dayType"], string> = {
  sun: "日",
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土",
  holiday: "祝日",
};

export const matrixDayTypes: HourlyWageRule["dayType"][] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
];

export function sortHourlyWageRulesByEffectiveFrom(
  hourlyWageRules: HourlyWageRule[],
) {
  return [...hourlyWageRules].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
}

export function parseBulkHourlyWageRuleDraft(
  value: string,
  isValidHourlyWage: (value: unknown) => value is number,
): number | null {
  if (!/^\d+$/.test(value)) return null;
  const hourlyWage = Number(value);
  return isValidHourlyWage(hourlyWage) ? hourlyWage : null;
}

export function formatEffectiveFrom(effectiveFrom: string) {
  return `${effectiveFrom.replaceAll("-", "/")}から`;
}

export function getAvailableEffectiveFromDates(
  hourlyWageRules: readonly HourlyWageRule[],
  userId: string,
) {
  return [
    ...new Set(
      hourlyWageRules
        .filter((hourlyWageRule) => hourlyWageRule.userId === userId)
        .map((hourlyWageRule) => hourlyWageRule.effectiveFrom),
    ),
  ].sort((a, b) => b.localeCompare(a));
}

export function getBulkChanges(
  drafts: Record<string, string>,
  hourlyWageRules: readonly HourlyWageRule[],
  userId: string,
  effectiveFrom: string,
  isValidHourlyWage: (value: unknown) => value is number,
  findApplicableHourlyWageRule: (
    hourlyWageRules: readonly HourlyWageRule[],
    selection: {
      userId: string;
      workPeriod: HourlyWageRule["workPeriod"];
      dayType: HourlyWageRule["dayType"];
      attendanceDate: string;
    },
  ) => HourlyWageRule | null,
) {
  return Object.entries(drafts).flatMap(([key, value]) => {
    if (value === "") return [];
    const [dayType, workPeriod] = key.split(":") as [
      HourlyWageRule["dayType"],
      HourlyWageRule["workPeriod"],
    ];
    const hourlyWage = parseBulkHourlyWageRuleDraft(value, isValidHourlyWage);
    if (hourlyWage === null) return [];
    const baseline = findApplicableHourlyWageRule(hourlyWageRules, {
      userId,
      workPeriod,
      dayType,
      attendanceDate: effectiveFrom,
    });
    if (baseline?.hourlyWage === hourlyWage) return [];
    return [
      {
        dayType,
        workPeriod,
        hourlyWage,
        expectedBaseline: baseline
          ? { id: baseline.id, version: baseline.version }
          : null,
      },
    ];
  });
}

import type { HourlyWageRuleResponse } from "@repo/contracts";

export type HourlyWageRuleHistoryEntry = HourlyWageRuleResponse;
export type HourlyWageRuleHistoryGroup = {
  effectiveFrom: string;
  changes: Array<{
    hourlyWageRule: HourlyWageRuleHistoryEntry;
    previous: number | null;
  }>;
};

const dayOrder: HourlyWageRuleHistoryEntry["dayType"][] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
];

export function getHistoryChanges(
  hourlyWageRules: readonly HourlyWageRuleHistoryEntry[],
): HourlyWageRuleHistoryGroup[] {
  const ordered = [...hourlyWageRules].sort(
    (a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom) ||
      dayOrder.indexOf(a.dayType) - dayOrder.indexOf(b.dayType) ||
      (a.workPeriod === b.workPeriod ? 0 : a.workPeriod === "day" ? -1 : 1),
  );
  const previous = new Map<string, number>();
  const groups = new Map<string, HourlyWageRuleHistoryGroup["changes"]>();
  for (const hourlyWageRule of ordered) {
    const key = `${hourlyWageRule.userId}\u0000${hourlyWageRule.dayType}\u0000${hourlyWageRule.workPeriod}`;
    const group = groups.get(hourlyWageRule.effectiveFrom) ?? [];
    group.push({ hourlyWageRule, previous: previous.get(key) ?? null });
    groups.set(hourlyWageRule.effectiveFrom, group);
    previous.set(key, hourlyWageRule.hourlyWage);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([effectiveFrom, changes]) => ({ effectiveFrom, changes }));
}

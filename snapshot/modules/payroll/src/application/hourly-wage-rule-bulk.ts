import type {
  BulkHourlyWageRuleChangeSet,
  BulkHourlyWageRuleOperation,
  BulkHourlyWageRulePlan,
  HourlyWageRuleManagementRecord,
} from "./ports/hourly-wage-rule-ports.ts";

export function planBulkHourlyWageRuleChanges(
  rows: readonly HourlyWageRuleManagementRecord[],
  input: BulkHourlyWageRuleChangeSet,
): BulkHourlyWageRulePlan {
  const baselineFor = (dayType: string, workPeriod: string) =>
    rows
      .filter(
        (row) =>
          row.dayType === dayType &&
          row.workPeriod === workPeriod &&
          row.effectiveFrom <= input.effectiveFrom,
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

  for (const change of input.changes) {
    const current = baselineFor(change.dayType, change.workPeriod);
    if (
      (current?.id ?? null) !== (change.expectedBaseline?.id ?? null) ||
      (current?.version ?? null) !== (change.expectedBaseline?.version ?? null)
    ) {
      return { kind: "bulk-conflict" };
    }
  }

  const operations: BulkHourlyWageRuleOperation[] = [];
  for (const change of input.changes) {
    const baseline = baselineFor(change.dayType, change.workPeriod);
    if (baseline?.hourlyWage === change.hourlyWage) continue;
    const exact = rows.find(
      (row) =>
        row.dayType === change.dayType &&
        row.workPeriod === change.workPeriod &&
        row.effectiveFrom === input.effectiveFrom,
    );
    operations.push(
      exact
        ? { kind: "update", row: exact, change }
        : { kind: "insert", change },
    );
  }
  return { kind: "success", operations };
}

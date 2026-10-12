import type { HourlyWageRule } from "../../domain/hourly-wage-rule.ts";

export type HourlyWageRuleManagementRecord = HourlyWageRule & {
  id: string;
  version: number;
  createdAt: string;
};

export type HourlyWageRuleReadStore = {
  findForPayrollEstimate(query: {
    userIds: readonly string[];
    startAttendanceDateInclusive: string;
    endAttendanceDateInclusive: string;
  }): Promise<readonly HourlyWageRule[]>;
};

export type HourlyWageRuleManagementPersistencePort = {
  findAllForUser(
    userId: string,
  ): Promise<readonly HourlyWageRuleManagementRecord[]>;
  create(
    input: HourlyWageRule & { userId: string },
  ): Promise<
    | { kind: "created"; hourlyWageRule: HourlyWageRuleManagementRecord }
    | { kind: "already-exists" }
  >;
  update(input: {
    userId: string;
    hourlyWageRuleId: string;
    expectedVersion: number;
    mutation: Omit<HourlyWageRule, "userId">;
  }): Promise<
    | { kind: "updated"; hourlyWageRule: HourlyWageRuleManagementRecord }
    | { kind: "rule-not-found" }
    | { kind: "version-conflict" }
    | { kind: "already-exists" }
  >;
  delete(input: {
    userId: string;
    hourlyWageRuleId: string;
    expectedVersion: number;
  }): Promise<
    | { kind: "deleted"; hourlyWageRuleId: string }
    | { kind: "rule-not-found" }
    | { kind: "version-conflict" }
  >;
  bulkUpdate(
    userId: string,
    input: BulkHourlyWageRuleChangeSet,
    plan: (
      rules: readonly HourlyWageRuleManagementRecord[],
    ) => BulkHourlyWageRulePlan,
  ): Promise<
    | {
        kind: "success";
        hourlyWageRules: HourlyWageRuleManagementRecord[];
      }
    | { kind: "bulk-conflict" }
  >;
};

type HourlyWageRuleBaseline = {
  id: string;
  version: number;
};

type BulkHourlyWageRuleChange = Omit<
  HourlyWageRule,
  "userId" | "effectiveFrom"
> & {
  expectedBaseline: HourlyWageRuleBaseline | null;
};

export type BulkHourlyWageRuleChangeSet = {
  effectiveFrom: string;
  changes: readonly BulkHourlyWageRuleChange[];
};

export type BulkHourlyWageRuleOperation =
  | {
      kind: "update";
      row: HourlyWageRuleManagementRecord;
      change: BulkHourlyWageRuleChange;
    }
  | { kind: "insert"; change: BulkHourlyWageRuleChange };

export type BulkHourlyWageRulePlan =
  | { kind: "bulk-conflict" }
  | { kind: "success"; operations: BulkHourlyWageRuleOperation[] };

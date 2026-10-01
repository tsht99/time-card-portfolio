import type { HourlyWageRate } from "../domain/hourly-wage-rate.ts";

export type HourlyWageRateApplicationResource = HourlyWageRate & {
  id: string;
  version: number;
  createdAt: string;
};

export type HourlyWageRateStore = {
  findAll(): Promise<readonly HourlyWageRate[]>;
};

export type HourlyWageRatePersistencePort = {
  findAllForUser(
    userId: string,
  ): Promise<readonly HourlyWageRateApplicationResource[]>;
  create(
    input: HourlyWageRate & { userId: string },
  ): Promise<
    | { kind: "created"; hourlyWageRate: HourlyWageRateApplicationResource }
    | { kind: "already-exists" }
  >;
  update(input: {
    userId: string;
    hourlyWageRateId: string;
    expectedVersion: number;
    mutation: Omit<HourlyWageRate, "userId">;
  }): Promise<
    | { kind: "updated"; hourlyWageRate: HourlyWageRateApplicationResource }
    | { kind: "rate-not-found" }
    | { kind: "version-conflict" }
    | { kind: "already-exists" }
  >;
  delete(input: {
    userId: string;
    hourlyWageRateId: string;
    expectedVersion: number;
  }): Promise<
    | { kind: "deleted"; hourlyWageRateId: string }
    | { kind: "rate-not-found" }
    | { kind: "version-conflict" }
  >;
  bulkUpdate(
    userId: string,
    input: BulkHourlyWageRateChangeSet,
    plan: (
      rates: readonly HourlyWageRateApplicationResource[],
    ) => BulkHourlyWageRatePlan,
  ): Promise<
    | {
        kind: "success";
        hourlyWageRates: HourlyWageRateApplicationResource[];
      }
    | { kind: "bulk-conflict" }
  >;
};

type HourlyWageRateBaseline = {
  id: string;
  version: number;
};

type BulkHourlyWageRateChange = Omit<
  HourlyWageRate,
  "userId" | "effectiveFrom"
> & {
  expectedBaseline: HourlyWageRateBaseline | null;
};

export type BulkHourlyWageRateChangeSet = {
  effectiveFrom: string;
  changes: readonly BulkHourlyWageRateChange[];
};

export type BulkHourlyWageRateOperation =
  | {
      kind: "update";
      row: HourlyWageRateApplicationResource;
      change: BulkHourlyWageRateChange;
    }
  | { kind: "insert"; change: BulkHourlyWageRateChange };

export type BulkHourlyWageRatePlan =
  | { kind: "bulk-conflict" }
  | { kind: "success"; operations: BulkHourlyWageRateOperation[] };

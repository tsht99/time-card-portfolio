import { canManageTargetUserData } from "@repo/users";
import type { HourlyWageRate } from "../domain/hourly-wage-rate.ts";
import { planBulkHourlyWageRateChanges } from "./hourly-wage-rate-bulk.ts";
import type {
  BulkHourlyWageRateChangeSet,
  HourlyWageRateApplicationResource,
  HourlyWageRatePersistencePort,
} from "./hourly-wage-rate-store.ts";
import type { PayrollUserReferenceReader } from "./user-reference.ts";

type CreateHourlyWageRateInput = Omit<HourlyWageRate, "userId"> & {
  actorUserId: string;
  userId: string;
};

type UpdateHourlyWageRateInput = Omit<HourlyWageRate, "userId"> & {
  actorUserId: string;
  userId: string;
  hourlyWageRateId: string;
  expectedVersion: number;
};

type DeleteHourlyWageRateInput = {
  actorUserId: string;
  userId: string;
  hourlyWageRateId: string;
  expectedVersion: number;
};

type BulkUpdateHourlyWageRatesInput = BulkHourlyWageRateChangeSet & {
  actorUserId: string;
  userId: string;
};

export type HourlyWageRateManagementApplication = {
  createHourlyWageRate(
    input: CreateHourlyWageRateInput,
  ): Promise<
    | { kind: "success"; hourlyWageRate: HourlyWageRateApplicationResource }
    | { kind: "user-not-found" | "role-forbidden" | "already-exists" }
  >;
  getHourlyWageRates(
    userId: string,
  ): Promise<
    | { kind: "success"; hourlyWageRates: HourlyWageRateApplicationResource[] }
    | { kind: "user-not-found" }
  >;
  updateHourlyWageRate(input: UpdateHourlyWageRateInput): Promise<
    | { kind: "success"; hourlyWageRate: HourlyWageRateApplicationResource }
    | {
        kind:
          | "user-not-found"
          | "role-forbidden"
          | "rate-not-found"
          | "version-conflict"
          | "already-exists";
      }
  >;
  deleteHourlyWageRate(input: DeleteHourlyWageRateInput): Promise<
    | { kind: "success"; hourlyWageRateId: string }
    | {
        kind:
          | "user-not-found"
          | "role-forbidden"
          | "rate-not-found"
          | "version-conflict";
      }
  >;
  bulkUpdateHourlyWageRates(input: BulkUpdateHourlyWageRatesInput): Promise<
    | {
        kind: "success";
        hourlyWageRates: HourlyWageRateApplicationResource[];
      }
    | { kind: "user-not-found" | "role-forbidden" | "bulk-conflict" }
  >;
};

export function createHourlyWageRateManagementApplication(dependencies: {
  userReferences: PayrollUserReferenceReader;
  hourlyWageRatePersistence: HourlyWageRatePersistencePort;
}): HourlyWageRateManagementApplication {
  const { userReferences, hourlyWageRatePersistence } = dependencies;
  const findUser = async (userId: string) => {
    const user = await userReferences.getUserById(userId);
    return user ? { userId: user.userId, role: user.role } : null;
  };

  return {
    async createHourlyWageRate(input) {
      const user = await findUser(input.userId);
      if (!user) return { kind: "user-not-found" };
      if (!canManageTargetUserData(input.actorUserId, user.userId, user.role))
        return { kind: "role-forbidden" };
      const result = await hourlyWageRatePersistence.create({
        userId: user.userId,
        workPeriod: input.workPeriod,
        dayType: input.dayType,
        hourlyWage: input.hourlyWage,
        effectiveFrom: input.effectiveFrom,
      });
      return result.kind === "created"
        ? { kind: "success", hourlyWageRate: result.hourlyWageRate }
        : result;
    },

    async getHourlyWageRates(userId) {
      const user = await findUser(userId);
      if (!user) return { kind: "user-not-found" };
      const rates = await hourlyWageRatePersistence.findAllForUser(user.userId);
      return {
        kind: "success",
        hourlyWageRates: [...rates].sort(
          (left, right) =>
            left.workPeriod.localeCompare(right.workPeriod) ||
            left.dayType.localeCompare(right.dayType) ||
            left.effectiveFrom.localeCompare(right.effectiveFrom),
        ),
      };
    },

    async updateHourlyWageRate(input) {
      const user = await findUser(input.userId);
      if (!user) return { kind: "user-not-found" };
      if (!canManageTargetUserData(input.actorUserId, user.userId, user.role))
        return { kind: "role-forbidden" };
      const result = await hourlyWageRatePersistence.update({
        userId: user.userId,
        hourlyWageRateId: input.hourlyWageRateId,
        expectedVersion: input.expectedVersion,
        mutation: {
          workPeriod: input.workPeriod,
          dayType: input.dayType,
          hourlyWage: input.hourlyWage,
          effectiveFrom: input.effectiveFrom,
        },
      });
      return result.kind === "updated"
        ? { kind: "success", hourlyWageRate: result.hourlyWageRate }
        : result;
    },

    async deleteHourlyWageRate(input) {
      const user = await findUser(input.userId);
      if (!user) return { kind: "user-not-found" };
      if (!canManageTargetUserData(input.actorUserId, user.userId, user.role))
        return { kind: "role-forbidden" };
      const result = await hourlyWageRatePersistence.delete({
        userId: user.userId,
        hourlyWageRateId: input.hourlyWageRateId,
        expectedVersion: input.expectedVersion,
      });
      return result.kind === "deleted"
        ? { kind: "success", hourlyWageRateId: result.hourlyWageRateId }
        : result;
    },

    async bulkUpdateHourlyWageRates(input) {
      const user = await findUser(input.userId);
      if (!user) return { kind: "user-not-found" };
      if (!canManageTargetUserData(input.actorUserId, user.userId, user.role))
        return { kind: "role-forbidden" };
      return hourlyWageRatePersistence.bulkUpdate(
        user.userId,
        {
          effectiveFrom: input.effectiveFrom,
          changes: input.changes,
        },
        (rates) => planBulkHourlyWageRateChanges(rates, input),
      );
    },
  };
}

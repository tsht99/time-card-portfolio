import { authorizeActiveAdmin, canManageTargetUserData } from "@repo/users";
import type { HourlyWageRule } from "../domain/hourly-wage-rule.ts";
import { planBulkHourlyWageRuleChanges } from "./hourly-wage-rule-bulk.ts";
import type {
  BulkHourlyWageRuleChangeSet,
  HourlyWageRuleManagementRecord,
} from "./ports/hourly-wage-rule-ports.ts";
import type {
  PayrollUnitOfWork,
  PayrollUserReferenceReader,
} from "./ports/user-reference.ts";

type CreateHourlyWageRuleInput = Omit<HourlyWageRule, "userId"> & {
  actorUserId: string;
  userId: string;
};

type UpdateHourlyWageRuleInput = Omit<HourlyWageRule, "userId"> & {
  actorUserId: string;
  userId: string;
  hourlyWageRuleId: string;
  expectedVersion: number;
};

type DeleteHourlyWageRuleInput = {
  actorUserId: string;
  userId: string;
  hourlyWageRuleId: string;
  expectedVersion: number;
};

type BulkUpdateHourlyWageRulesInput = BulkHourlyWageRuleChangeSet & {
  actorUserId: string;
  userId: string;
};

export type HourlyWageRuleManagementApplication = {
  createHourlyWageRule(
    input: CreateHourlyWageRuleInput,
  ): Promise<
    | { kind: "success"; hourlyWageRule: HourlyWageRuleManagementRecord }
    | { kind: "user-not-found" | "role-forbidden" | "already-exists" }
  >;
  getHourlyWageRules(input: {
    actorUserId: string;
    userId: string;
  }): Promise<
    | { kind: "success"; hourlyWageRules: HourlyWageRuleManagementRecord[] }
    | { kind: "user-not-found" }
    | { kind: "role-forbidden" }
  >;
  updateHourlyWageRule(input: UpdateHourlyWageRuleInput): Promise<
    | { kind: "success"; hourlyWageRule: HourlyWageRuleManagementRecord }
    | {
        kind:
          | "user-not-found"
          | "role-forbidden"
          | "rule-not-found"
          | "version-conflict"
          | "already-exists";
      }
  >;
  deleteHourlyWageRule(input: DeleteHourlyWageRuleInput): Promise<
    | { kind: "success"; hourlyWageRuleId: string }
    | {
        kind:
          | "user-not-found"
          | "role-forbidden"
          | "rule-not-found"
          | "version-conflict";
      }
  >;
  bulkUpdateHourlyWageRules(input: BulkUpdateHourlyWageRulesInput): Promise<
    | {
        kind: "success";
        hourlyWageRules: HourlyWageRuleManagementRecord[];
      }
    | { kind: "user-not-found" | "role-forbidden" | "bulk-conflict" }
  >;
};

export function createHourlyWageRuleManagementApplication(dependencies: {
  unitOfWork: PayrollUnitOfWork;
}): HourlyWageRuleManagementApplication {
  const { unitOfWork } = dependencies;
  const authorize = async (
    users: PayrollUserReferenceReader,
    actorUserId: string,
    targetUserId: string,
  ) => {
    const actor = await users.getUserById(actorUserId);
    if (!authorizeActiveAdmin(actor).ok)
      return { kind: "role-forbidden" as const };
    const target = await users.getUserById(targetUserId);
    if (!target) return { kind: "user-not-found" as const };
    if (!canManageTargetUserData(actorUserId, target.userId, target.role))
      return { kind: "role-forbidden" as const };
    return { kind: "success" as const, target };
  };

  return {
    async createHourlyWageRule(input) {
      return unitOfWork.run(
        async ({ users, hourlyWageRuleManagementPersistence }) => {
          const auth = await authorize(users, input.actorUserId, input.userId);
          if (auth.kind !== "success") return auth;
          const result = await hourlyWageRuleManagementPersistence.create({
            userId: auth.target.userId,
            workPeriod: input.workPeriod,
            dayType: input.dayType,
            hourlyWage: input.hourlyWage,
            effectiveFrom: input.effectiveFrom,
          });
          return result.kind === "created"
            ? { kind: "success", hourlyWageRule: result.hourlyWageRule }
            : result;
        },
      );
    },

    async getHourlyWageRules(input) {
      return unitOfWork.run(
        async ({ users, hourlyWageRuleManagementPersistence }) => {
          const auth = await authorize(users, input.actorUserId, input.userId);
          if (auth.kind !== "success") return auth;
          const rules =
            await hourlyWageRuleManagementPersistence.findAllForUser(
              auth.target.userId,
            );
          return {
            kind: "success",
            hourlyWageRules: [...rules].sort(
              (left, right) =>
                left.workPeriod.localeCompare(right.workPeriod) ||
                left.dayType.localeCompare(right.dayType) ||
                left.effectiveFrom.localeCompare(right.effectiveFrom),
            ),
          };
        },
      );
    },

    async updateHourlyWageRule(input) {
      return unitOfWork.run(
        async ({ users, hourlyWageRuleManagementPersistence }) => {
          const auth = await authorize(users, input.actorUserId, input.userId);
          if (auth.kind !== "success") return auth;
          const result = await hourlyWageRuleManagementPersistence.update({
            userId: auth.target.userId,
            hourlyWageRuleId: input.hourlyWageRuleId,
            expectedVersion: input.expectedVersion,
            mutation: {
              workPeriod: input.workPeriod,
              dayType: input.dayType,
              hourlyWage: input.hourlyWage,
              effectiveFrom: input.effectiveFrom,
            },
          });
          return result.kind === "updated"
            ? { kind: "success", hourlyWageRule: result.hourlyWageRule }
            : result;
        },
      );
    },

    async deleteHourlyWageRule(input) {
      return unitOfWork.run(
        async ({ users, hourlyWageRuleManagementPersistence }) => {
          const auth = await authorize(users, input.actorUserId, input.userId);
          if (auth.kind !== "success") return auth;
          const result = await hourlyWageRuleManagementPersistence.delete({
            userId: auth.target.userId,
            hourlyWageRuleId: input.hourlyWageRuleId,
            expectedVersion: input.expectedVersion,
          });
          return result.kind === "deleted"
            ? { kind: "success", hourlyWageRuleId: result.hourlyWageRuleId }
            : result;
        },
      );
    },

    async bulkUpdateHourlyWageRules(input) {
      return unitOfWork.run(
        async ({ users, hourlyWageRuleManagementPersistence }) => {
          const auth = await authorize(users, input.actorUserId, input.userId);
          if (auth.kind !== "success") return auth;
          return hourlyWageRuleManagementPersistence.bulkUpdate(
            auth.target.userId,
            {
              effectiveFrom: input.effectiveFrom,
              changes: input.changes,
            },
            (rules) => planBulkHourlyWageRuleChanges(rules, input),
          );
        },
      );
    },
  };
}

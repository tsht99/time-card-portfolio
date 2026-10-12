import type { HourlyWageRuleResponse } from "@repo/contracts";

export type AdminHourlyWageRulesState =
  | { status: "ready"; data: HourlyWageRuleResponse[] }
  | { status: "missing"; message: string }
  | { status: "error"; code?: "USER_NOT_FOUND"; message: string }
  | {
      status: "unavailable";
      code: "ADMIN_ACCESS_REQUIRED" | "ACTOR_NOT_ACTIVE";
      message: string;
    };

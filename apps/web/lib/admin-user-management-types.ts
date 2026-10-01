import type { UserListItem } from "@repo/contracts";
import type { HourlyWageRateResource } from "@repo/payroll/contracts";

type AdminUserManagementReadState<T> =
  | { status: "ready"; data: T }
  | { status: "missing"; message: string }
  | {
      status: "unavailable";
      code: "ADMIN_ACCESS_REQUIRED" | "ACTOR_NOT_ACTIVE";
      message: string;
    }
  | { status: "error"; code?: "USER_NOT_FOUND"; message: string };

export type AdminUsersState = AdminUserManagementReadState<UserListItem[]>;
export type AdminHourlyWageRatesState = AdminUserManagementReadState<
  HourlyWageRateResource[]
>;

export type AdminUserManagementActionResult =
  | { success: true }
  | {
      success: false;
      code?:
        | "SESSION_EXPIRED"
        | "ADMIN_ACCESS_REQUIRED"
        | "ACTOR_NOT_ACTIVE"
        | "USER_NOT_FOUND"
        | "ADMIN_STATUS_UPDATE_FORBIDDEN"
        | "USER_DISPLAY_NAME_CONFLICT"
        | "ADMIN_DISPLAY_NAME_UPDATE_FORBIDDEN"
        | "USER_STATUS_TRANSITION_FORBIDDEN"
        | "USER_DISPLAY_NAME_REQUIRED"
        | "USER_DISPLAY_NAME_TOO_LONG"
        | "HOURLY_WAGE_RATE_UPDATE_FORBIDDEN"
        | "HOURLY_WAGE_RATE_NOT_FOUND"
        | "HOURLY_WAGE_RATE_ALREADY_EXISTS"
        | "HOURLY_WAGE_RATE_VERSION_CONFLICT"
        | "HOURLY_WAGE_RATE_BULK_CONFLICT";
      message: string;
    };

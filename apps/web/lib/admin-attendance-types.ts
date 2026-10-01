import type {
  AdminAttendanceDetail,
  AdminUserMonthlyPayrollDetail,
  AttendanceListItem,
  CancelledAttendanceListItem,
  UserMonthlyPayrollSummary,
} from "@repo/contracts";

import type { AdminReadState } from "./admin-read-state";

export type AdminAttendanceListState = AdminReadState<AttendanceListItem[]>;
export type AdminCancelledAttendanceListState = AdminReadState<
  CancelledAttendanceListItem[]
>;
export type AdminMonthlyPayrollSummaryState = AdminReadState<
  UserMonthlyPayrollSummary[]
>;
export type AdminAttendanceDetailState = AdminReadState<AdminAttendanceDetail>;
export type AdminUserMonthlyPayrollDetailState =
  AdminReadState<AdminUserMonthlyPayrollDetail>;

export type AdminAttendanceActionResult =
  | { success: true; attendanceId?: string }
  | {
      success: false;
      code?:
        | "SESSION_EXPIRED"
        | "ADMIN_ACCESS_REQUIRED"
        | "ACTOR_NOT_ACTIVE"
        | "ATTENDANCE_VERSION_CONFLICT"
        | "ATTENDANCE_TIME_OVERLAP";
      message: string;
    };

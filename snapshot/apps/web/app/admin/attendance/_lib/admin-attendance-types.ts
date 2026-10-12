import type { AdminAttendanceList } from "@repo/attendance";
import type {
  AdminAttendanceDetail,
  AttendanceListItem,
  CancelledAttendanceListItem,
} from "@repo/contracts";

import type { AdminReadState } from "../../_lib/admin-read-state.ts";

export type AdminAttendanceListState = AdminReadState<AdminAttendanceList>;
export type AdminAttendanceViewState = AdminReadState<{
  attendance: AttendanceListItem[];
  cancelledAttendance: CancelledAttendanceListItem[];
}>;
export type AdminAttendanceDetailState = AdminReadState<AdminAttendanceDetail>;

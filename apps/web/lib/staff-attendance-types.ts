import type {
  StaffAttendanceItem,
  StaffCurrentAttendance,
} from "@repo/contracts";

type StaffAttendanceReadState<T> =
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export type { StaffCurrentAttendance };

export type StaffAttendanceHistory = StaffAttendanceItem[];

export type StaffCurrentAttendanceReadState =
  StaffAttendanceReadState<StaffCurrentAttendance>;

export type StaffAttendanceHistoryReadState =
  StaffAttendanceReadState<StaffAttendanceHistory>;

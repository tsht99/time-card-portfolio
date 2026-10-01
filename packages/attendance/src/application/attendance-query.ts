import type { AttendanceListStatus } from "../domain/attendance.ts";

export function filterAttendanceList<
  T extends { status: AttendanceListStatus },
>(items: readonly T[], status: AttendanceListStatus | undefined): T[] {
  return status ? items.filter((item) => item.status === status) : [...items];
}

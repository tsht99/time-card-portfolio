import type { StaffAttendanceItem } from "@repo/contracts";

export function compareAttendances(
  left: StaffAttendanceItem,
  right: StaffAttendanceItem,
): number {
  const leftTime = new Date(left.clockInAt).getTime();
  const rightTime = new Date(right.clockInAt).getTime();
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  return left.attendanceId.localeCompare(right.attendanceId);
}

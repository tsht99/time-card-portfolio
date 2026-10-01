import type {
  StaffAttendanceItem,
  StaffCurrentAttendance,
} from "@repo/contracts";
import { compareAttendances } from "./staff-attendance-order";

export type MonthlyRow = {
  date: string;
  attendance: {
    day: StaffAttendanceItem[];
    night: StaffAttendanceItem[];
  };
};

function reconcileAttendances(
  history: readonly StaffAttendanceItem[],
  current: readonly StaffAttendanceItem[],
): StaffAttendanceItem[] {
  const attendances = new Map<string, StaffAttendanceItem>();
  for (const attendance of history) {
    attendances.set(attendance.attendanceId, attendance);
  }
  for (const attendance of current) {
    const existing = attendances.get(attendance.attendanceId);
    if (!existing || attendance.eventVersion >= existing.eventVersion) {
      attendances.set(attendance.attendanceId, attendance);
    }
  }
  return [...attendances.values()];
}

export function mergeMonthlyAttendance(
  history: readonly StaffAttendanceItem[],
  current: StaffCurrentAttendance | null | undefined,
  selectedMonth: string,
): MonthlyRow[] {
  const reconciled = reconcileAttendances(
    history,
    current?.attendances ?? [],
  ).filter((attendance) =>
    attendance.attendanceDate.startsWith(`${selectedMonth}-`),
  );
  const rows = new Map<string, MonthlyRow>();

  for (const attendance of reconciled) {
    const row = rows.get(attendance.attendanceDate) ?? {
      date: attendance.attendanceDate,
      attendance: { day: [], night: [] },
    };
    row.attendance[attendance.workPeriod].push(attendance);
    rows.set(attendance.attendanceDate, row);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      attendance: {
        day: [...row.attendance.day].sort(compareAttendances),
        night: [...row.attendance.night].sort(compareAttendances),
      },
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

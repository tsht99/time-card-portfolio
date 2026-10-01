import { getHourlyWageDayType } from "../domain/hourly-wage-day-type.ts";
import {
  findApplicableHourlyWageRate,
  type HourlyWageRate,
} from "../domain/hourly-wage-rate.ts";
import type {
  MonthlyPayrollAttendance,
  MonthlyPayrollDetailAttendance,
} from "../domain/monthly-payroll-summary.ts";

export type PayrollAttendanceCurrentState = {
  attendanceId: string;
  userId: string;
  attendanceDate: string;
  workPeriod: "day" | "night";
  clockInAt: Date | null;
  clockOutAt: Date | null;
};

function isTargetMonth(attendanceDate: string, yearMonth: string): boolean {
  return attendanceDate.startsWith(`${yearMonth}-`);
}

function resolveHourlyWage(
  state: Pick<
    PayrollAttendanceCurrentState,
    "userId" | "workPeriod" | "attendanceDate"
  >,
  rates: readonly HourlyWageRate[],
): number | null {
  return (
    findApplicableHourlyWageRate(rates, {
      userId: state.userId,
      workPeriod: state.workPeriod,
      attendanceDate: state.attendanceDate,
      dayType: getHourlyWageDayType(state.attendanceDate),
    })?.hourlyWage ?? null
  );
}

/** Build monthly payroll calculation inputs while resolving wages at the reporting boundary. */
export function buildMonthlyPayrollAttendances(
  states: readonly PayrollAttendanceCurrentState[],
  rates: readonly HourlyWageRate[],
  yearMonth: string,
): MonthlyPayrollAttendance[] {
  return states
    .filter((state) => isTargetMonth(state.attendanceDate, yearMonth))
    .map((state) => {
      return {
        userId: state.userId,
        attendanceDate: state.attendanceDate,
        clockInAt: state.clockInAt,
        clockOutAt: state.clockOutAt,
        hourlyWage: resolveHourlyWage(state, rates),
      };
    });
}

/** Build the attendance input that preserves identity and work period for payroll details. */
export function buildMonthlyPayrollDetailAttendances(
  states: readonly PayrollAttendanceCurrentState[],
  rates: readonly HourlyWageRate[],
  yearMonth: string,
): MonthlyPayrollDetailAttendance[] {
  return states
    .filter((state) => isTargetMonth(state.attendanceDate, yearMonth))
    .map((state) => ({
      attendanceId: state.attendanceId,
      userId: state.userId,
      attendanceDate: state.attendanceDate,
      workPeriod: state.workPeriod,
      clockInAt: state.clockInAt,
      clockOutAt: state.clockOutAt,
      hourlyWage: resolveHourlyWage(state, rates),
    }));
}

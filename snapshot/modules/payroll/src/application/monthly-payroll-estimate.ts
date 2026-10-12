import { getHourlyWageDayType } from "../domain/hourly-wage-day-type.ts";
import {
  findApplicableHourlyWageRule,
  type HourlyWageRule,
} from "../domain/hourly-wage-rule.ts";
import type {
  PayrollEstimateAttendance,
  PayrollEstimateAttendanceDetail,
} from "../domain/monthly-payroll-estimate-summary.ts";

export type PayrollEstimateAttendanceInput = {
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
    PayrollEstimateAttendanceInput,
    "userId" | "workPeriod" | "attendanceDate"
  >,
  rules: readonly HourlyWageRule[],
): number | null {
  return (
    findApplicableHourlyWageRule(rules, {
      userId: state.userId,
      workPeriod: state.workPeriod,
      attendanceDate: state.attendanceDate,
      dayType: getHourlyWageDayType(state.attendanceDate),
    })?.hourlyWage ?? null
  );
}

function indexHourlyWageRules(rules: readonly HourlyWageRule[]) {
  const index = new Map<string, HourlyWageRule[]>();
  for (const rule of rules) {
    const key = `${rule.userId}\u0000${rule.workPeriod}\u0000${rule.dayType}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(rule);
    else index.set(key, [rule]);
  }
  return index;
}

function rulesForState(
  state: PayrollEstimateAttendanceInput,
  index: ReadonlyMap<string, readonly HourlyWageRule[]>,
): readonly HourlyWageRule[] {
  return (
    index.get(
      `${state.userId}\u0000${state.workPeriod}\u0000${getHourlyWageDayType(state.attendanceDate)}`,
    ) ?? []
  );
}

/** Build monthly payroll estimate inputs while resolving wages at the reporting boundary. */
export function buildPayrollEstimateAttendances(
  states: readonly PayrollEstimateAttendanceInput[],
  rules: readonly HourlyWageRule[],
  yearMonth: string,
): PayrollEstimateAttendance[] {
  const rulesIndex = indexHourlyWageRules(rules);
  return states
    .filter((state) => isTargetMonth(state.attendanceDate, yearMonth))
    .map((state) => {
      return {
        userId: state.userId,
        attendanceDate: state.attendanceDate,
        clockInAt: state.clockInAt,
        clockOutAt: state.clockOutAt,
        hourlyWage: resolveHourlyWage(state, rulesForState(state, rulesIndex)),
      };
    });
}

/** Build the attendance input that preserves identity and work period for payroll estimate details. */
export function buildPayrollEstimateAttendanceDetails(
  states: readonly PayrollEstimateAttendanceInput[],
  rules: readonly HourlyWageRule[],
  yearMonth: string,
): PayrollEstimateAttendanceDetail[] {
  const rulesIndex = indexHourlyWageRules(rules);
  return states
    .filter((state) => isTargetMonth(state.attendanceDate, yearMonth))
    .map((state) => ({
      attendanceId: state.attendanceId,
      userId: state.userId,
      attendanceDate: state.attendanceDate,
      workPeriod: state.workPeriod,
      clockInAt: state.clockInAt,
      clockOutAt: state.clockOutAt,
      hourlyWage: resolveHourlyWage(state, rulesForState(state, rulesIndex)),
    }));
}

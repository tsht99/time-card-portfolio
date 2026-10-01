// cspell:ignore uncomputed

import type { WorkPeriod } from "./hourly-wage-rate.ts";

function calculateWorkedMinutes(clockInAt: Date, clockOutAt: Date): number {
  const elapsedMilliseconds = clockOutAt.getTime() - clockInAt.getTime();
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw new RangeError("clockOutAt must not be earlier than clockInAt.");
  }
  return Math.floor(elapsedMilliseconds / 60_000);
}

export type MonthlyPayrollAttendance = {
  userId: string;
  attendanceDate: string;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  hourlyWage: number | null;
};

export type MonthlyPayrollDetailAttendance = MonthlyPayrollAttendance & {
  attendanceId: string;
  workPeriod: WorkPeriod;
};

type MonthlyPayrollCalculationStatus =
  | "calculated"
  | "missingHourlyWage"
  | "clockOutMissing"
  | "incomplete";

type UserMonthlyPayrollDetailAttendance = {
  attendanceId: string;
  attendanceDate: string;
  workPeriod: WorkPeriod;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  workedMinutes: number | null;
  hourlyWage: number | null;
  estimatedPayYenTimes60: number | null;
  estimatedPayYen: number | null;
  status: MonthlyPayrollCalculationStatus;
};

export type UserMonthlyPayrollDetail = {
  userId: string;
  month: string;
  totalEstimatedPayYen: number;
  uncomputedCount: number;
  roundingAdjustmentYen: number;
  attendances: UserMonthlyPayrollDetailAttendance[];
};

export type UserMonthlyPayrollSummary = {
  userId: string;
  incompleteCount: number;
  missingHourlyWageCount: number;
  hasWorkingAttendance: boolean;
  otherIncompleteCount: number;
  totalWorkedMinutes: number;
  totalEstimatedPayYen: number;
};

function assertYearMonth(yearMonth: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw new RangeError(`Invalid yearMonth: ${yearMonth}`);
  }
}

type AttendancePayrollCalculation = {
  isWorkingAttendance: boolean;
  workedMinutes: number | null;
  estimatedPayYenTimes60: number | null;
  status: MonthlyPayrollCalculationStatus;
};

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function calculateAttendancePayroll(
  attendance: MonthlyPayrollAttendance,
): AttendancePayrollCalculation {
  const { clockInAt, clockOutAt } = attendance;
  const isWorkingAttendance = clockOutAt === null && isValidDate(clockInAt);

  if (!isValidDate(clockInAt)) {
    return {
      isWorkingAttendance: false,
      workedMinutes: null,
      estimatedPayYenTimes60: null,
      status: "incomplete",
    };
  }

  if (clockOutAt === null) {
    return {
      isWorkingAttendance,
      workedMinutes: null,
      estimatedPayYenTimes60: null,
      status: "clockOutMissing",
    };
  }

  if (!isValidDate(clockOutAt)) {
    return {
      isWorkingAttendance: false,
      workedMinutes: null,
      estimatedPayYenTimes60: null,
      status: "incomplete",
    };
  }

  let workedMinutes: number;
  try {
    workedMinutes = calculateWorkedMinutes(clockInAt, clockOutAt);
  } catch {
    return {
      isWorkingAttendance: false,
      workedMinutes: null,
      estimatedPayYenTimes60: null,
      status: "incomplete",
    };
  }

  if (attendance.hourlyWage === null) {
    return {
      isWorkingAttendance: false,
      workedMinutes,
      estimatedPayYenTimes60: null,
      status: "missingHourlyWage",
    };
  }

  if (!Number.isSafeInteger(attendance.hourlyWage)) {
    return {
      isWorkingAttendance: false,
      workedMinutes,
      estimatedPayYenTimes60: null,
      status: "incomplete",
    };
  }

  const estimatedPayYenTimes60 = workedMinutes * attendance.hourlyWage;
  if (!Number.isSafeInteger(estimatedPayYenTimes60)) {
    return {
      isWorkingAttendance: false,
      workedMinutes,
      estimatedPayYenTimes60: null,
      status: "incomplete",
    };
  }

  return {
    isWorkingAttendance: false,
    workedMinutes,
    estimatedPayYenTimes60,
    status: "calculated",
  };
}

export function summarizeMonthlyPayroll(
  attendances: readonly MonthlyPayrollAttendance[],
  yearMonth: string,
): UserMonthlyPayrollSummary[] {
  assertYearMonth(yearMonth);

  type MonthlyPayrollSummaryAccumulator = Omit<
    UserMonthlyPayrollSummary,
    "totalEstimatedPayYen"
  > & {
    totalEstimatedPayYenTimes60: number;
  };
  const summaries = new Map<string, MonthlyPayrollSummaryAccumulator>();

  for (const attendance of attendances) {
    if (!attendance.attendanceDate.startsWith(`${yearMonth}-`)) continue;

    let summary = summaries.get(attendance.userId);
    if (summary === undefined) {
      summary = {
        userId: attendance.userId,
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 0,
        totalEstimatedPayYenTimes60: 0,
      };
      summaries.set(attendance.userId, summary);
    }

    const calculation = calculateAttendancePayroll(attendance);
    if (calculation.isWorkingAttendance) summary.hasWorkingAttendance = true;
    if (calculation.workedMinutes === null) {
      summary.incompleteCount += 1;
      if (!calculation.isWorkingAttendance) summary.otherIncompleteCount += 1;
      continue;
    }

    summary.totalWorkedMinutes += calculation.workedMinutes;

    if (attendance.hourlyWage === null) {
      summary.missingHourlyWageCount += 1;
      continue;
    }
    if (calculation.estimatedPayYenTimes60 === null) continue;

    summary.totalEstimatedPayYenTimes60 += calculation.estimatedPayYenTimes60;
  }

  return [...summaries.values()].map((summary) => ({
    userId: summary.userId,
    incompleteCount: summary.incompleteCount,
    missingHourlyWageCount: summary.missingHourlyWageCount,
    hasWorkingAttendance: summary.hasWorkingAttendance,
    otherIncompleteCount: summary.otherIncompleteCount,
    totalWorkedMinutes: summary.totalWorkedMinutes,
    totalEstimatedPayYen: Math.round(summary.totalEstimatedPayYenTimes60 / 60),
  }));
}

export function calculateUserMonthlyPayrollDetail(
  attendances: readonly MonthlyPayrollDetailAttendance[],
  yearMonth: string,
  userId: string,
): UserMonthlyPayrollDetail {
  assertYearMonth(yearMonth);

  const details = attendances
    .filter(
      (attendance) =>
        attendance.userId === userId &&
        attendance.attendanceDate.startsWith(`${yearMonth}-`),
    )
    .map((attendance) => {
      const calculation = calculateAttendancePayroll(attendance);
      return {
        attendanceId: attendance.attendanceId,
        attendanceDate: attendance.attendanceDate,
        workPeriod: attendance.workPeriod,
        clockInAt: attendance.clockInAt,
        clockOutAt: attendance.clockOutAt,
        workedMinutes: calculation.workedMinutes,
        hourlyWage: attendance.hourlyWage,
        estimatedPayYenTimes60: calculation.estimatedPayYenTimes60,
        estimatedPayYen:
          calculation.estimatedPayYenTimes60 === null
            ? null
            : Math.round(calculation.estimatedPayYenTimes60 / 60),
        status: calculation.status,
      } satisfies UserMonthlyPayrollDetailAttendance;
    });

  const totalEstimatedPayYenTimes60 = details.reduce(
    (total, detail) => total + (detail.estimatedPayYenTimes60 ?? 0),
    0,
  );
  const totalEstimatedPayYen = Math.round(totalEstimatedPayYenTimes60 / 60);
  const displayedEstimatedPayYen = details.reduce(
    (total, detail) => total + (detail.estimatedPayYen ?? 0),
    0,
  );

  return {
    userId,
    month: yearMonth,
    totalEstimatedPayYen,
    uncomputedCount: details.filter((detail) => detail.status !== "calculated")
      .length,
    roundingAdjustmentYen: totalEstimatedPayYen - displayedEstimatedPayYen,
    attendances: details,
  };
}

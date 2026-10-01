import {
  calculateUserMonthlyPayrollDetail,
  summarizeMonthlyPayroll,
  type UserMonthlyPayrollDetail,
} from "../domain/monthly-payroll-summary.ts";
import type { HourlyWageRateStore } from "./hourly-wage-rate-store.ts";
import {
  buildMonthlyPayrollAttendances,
  buildMonthlyPayrollDetailAttendances,
  type PayrollAttendanceCurrentState,
} from "./monthly-payroll.ts";
import type { PayrollUserReferenceReader } from "./user-reference.ts";

export class PayrollTargetUserNotFoundError extends Error {
  constructor() {
    super("Target user was not found.");
    this.name = "PayrollTargetUserNotFoundError";
  }
}

export type AttendancePayrollQueryPort = {
  getCurrentStates(
    query: {
      startAttendanceDateInclusive: string;
      endAttendanceDateInclusive: string;
      userId?: string;
    },
    fallbackUserId?: string,
  ): Promise<readonly PayrollAttendanceCurrentState[]>;
  getAdminAttendanceDetail(attendanceId: string): Promise<{
    attendanceId: string;
    attendanceDate: string;
    userId: string;
    workPeriod: "day" | "night";
    clockInAt: string;
    clockOutAt: string | null;
    status: string;
  }>;
};

export type PayrollUserMonthlyPayrollDetail = Omit<
  UserMonthlyPayrollDetail,
  "attendances"
> & {
  displayName: string | null;
  attendances: Array<
    Omit<
      UserMonthlyPayrollDetail["attendances"][number],
      "clockInAt" | "clockOutAt"
    > & {
      workedMinutes: number | null;
      estimatedPayYenTimes60: number | null;
      estimatedPayYen: number | null;
      status: UserMonthlyPayrollDetail["attendances"][number]["status"];
      clockInAt: string | null;
      clockOutAt: string | null;
    }
  >;
};

function getMonthDateRange(month: string): {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
} {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`Invalid year-month: ${month}`);
  const monthNumber = Number(match[2]);
  const startAttendanceDateInclusive = `${match[1]}-${match[2]}-01`;
  const nextMonth = new Date(`${startAttendanceDateInclusive}T00:00:00.000Z`);
  nextMonth.setUTCMonth(monthNumber);
  nextMonth.setUTCDate(0);
  return {
    startAttendanceDateInclusive,
    endAttendanceDateInclusive: nextMonth.toISOString().slice(0, 10),
  };
}

function toIsoOrNull(value: Date | null): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return null;
  return value.toISOString();
}

function compareAttendance(
  left: {
    attendanceDate: string;
    clockInAt: Date | null;
    attendanceId: string;
  },
  right: {
    attendanceDate: string;
    clockInAt: Date | null;
    attendanceId: string;
  },
): number {
  const dateOrder = left.attendanceDate.localeCompare(right.attendanceDate);
  if (dateOrder !== 0) return dateOrder;
  const leftTime = left.clockInAt?.getTime() ?? Number.NaN;
  const rightTime = right.clockInAt?.getTime() ?? Number.NaN;
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime))
    return Number.isFinite(leftTime) ? -1 : 1;
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  )
    return leftTime - rightTime;
  return left.attendanceId.localeCompare(right.attendanceId);
}

export function createAttendancePayrollApplication(dependencies: {
  attendance: AttendancePayrollQueryPort;
  hourlyWageRateStore: HourlyWageRateStore;
  userReferences: PayrollUserReferenceReader;
}) {
  const { attendance, hourlyWageRateStore, userReferences } = dependencies;
  return {
    async getMonthlyPayrollSummary(month: string) {
      const { startAttendanceDateInclusive, endAttendanceDateInclusive } =
        getMonthDateRange(month);
      const [states, rates] = await Promise.all([
        attendance.getCurrentStates({
          startAttendanceDateInclusive,
          endAttendanceDateInclusive,
        }),
        hourlyWageRateStore.findAll(),
      ]);
      return {
        month,
        summaries: summarizeMonthlyPayroll(
          buildMonthlyPayrollAttendances(states, rates, month),
          month,
        ),
      };
    },
    async getUserMonthlyPayrollDetail(
      userId: string,
      month: string,
    ): Promise<PayrollUserMonthlyPayrollDetail> {
      const target = await userReferences.getUserById(userId);
      if (!target) throw new PayrollTargetUserNotFoundError();
      const { startAttendanceDateInclusive, endAttendanceDateInclusive } =
        getMonthDateRange(month);
      const [states, rates] = await Promise.all([
        attendance.getCurrentStates(
          { userId, startAttendanceDateInclusive, endAttendanceDateInclusive },
          userId,
        ),
        hourlyWageRateStore.findAll(),
      ]);
      const detail = calculateUserMonthlyPayrollDetail(
        buildMonthlyPayrollDetailAttendances(states, rates, month).sort(
          compareAttendance,
        ),
        month,
        userId,
      );
      return {
        ...detail,
        displayName: target.displayName,
        attendances: detail.attendances.map((item) => ({
          ...item,
          clockInAt: toIsoOrNull(item.clockInAt),
          clockOutAt: toIsoOrNull(item.clockOutAt),
        })),
      };
    },
    async getAttendancePayrollEstimate(attendanceId: string) {
      const detail = await attendance.getAdminAttendanceDetail(attendanceId);
      if (detail.status === "cancelled")
        return {
          hourlyWage: null,
          estimatedPayYen: null,
          status: "excluded" as const,
        };
      const rates = await hourlyWageRateStore.findAll();
      const attendanceState: PayrollAttendanceCurrentState = {
        attendanceId: detail.attendanceId,
        userId: detail.userId,
        attendanceDate: detail.attendanceDate,
        workPeriod: detail.workPeriod,
        clockInAt: new Date(detail.clockInAt),
        clockOutAt:
          detail.clockOutAt === null ? null : new Date(detail.clockOutAt),
      };
      const [item] = buildMonthlyPayrollDetailAttendances(
        [attendanceState],
        rates,
        detail.attendanceDate.slice(0, 7),
      );
      const calculated = calculateUserMonthlyPayrollDetail(
        item ? [item] : [],
        detail.attendanceDate.slice(0, 7),
        detail.userId,
      ).attendances[0];
      return calculated
        ? {
            hourlyWage: calculated.hourlyWage,
            estimatedPayYen: calculated.estimatedPayYen,
            status: calculated.status,
          }
        : {
            hourlyWage: null,
            estimatedPayYen: null,
            status: "incomplete" as const,
          };
    },
  };
}

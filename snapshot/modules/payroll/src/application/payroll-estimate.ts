import { authorizeActiveAdmin } from "@repo/users";
import {
  type UserMonthlyPayrollEstimateDetail as CalculatedUserMonthlyPayrollEstimateDetail,
  calculateUserMonthlyPayrollEstimateDetail,
  summarizeMonthlyPayrollEstimate,
} from "../domain/monthly-payroll-estimate-summary.ts";
import {
  buildPayrollEstimateAttendanceDetails,
  buildPayrollEstimateAttendances,
  type PayrollEstimateAttendanceInput,
} from "./monthly-payroll-estimate.ts";
import type { PayrollEstimateAttendanceQueryPort } from "./ports/payroll-estimate-attendance-query.ts";
import type { PayrollUnitOfWork } from "./ports/user-reference.ts";

export class PayrollEstimateTargetUserNotFoundError extends Error {
  constructor() {
    super("Target user was not found.");
    this.name = "PayrollEstimateTargetUserNotFoundError";
  }
}

export class PayrollEstimateForbiddenError extends Error {
  constructor(
    readonly code:
      | "ACTOR_NOT_ACTIVE"
      | "ADMIN_ACCESS_REQUIRED"
      | "TARGET_FORBIDDEN" = "TARGET_FORBIDDEN",
  ) {
    super("Payroll estimate access is forbidden.");
    this.name = "PayrollEstimateForbiddenError";
  }
}

export type UserMonthlyPayrollEstimateDetail = Omit<
  CalculatedUserMonthlyPayrollEstimateDetail,
  "attendances"
> & {
  displayName: string | null;
  attendances: Array<
    CalculatedUserMonthlyPayrollEstimateDetail["attendances"][number]
  >;
};

/** Minimal Attendance-owned state needed to calculate one payroll estimate. */
export type PayrollEstimateAttendanceSnapshot =
  PayrollEstimateAttendanceInput & {
    cancelled: boolean;
  };

function getMonthDateRange(month: string): {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
} {
  const match = /^(?!0000)(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`Invalid year-month: ${month}`);
  const monthNumber = Number(match[2]);
  if (Number(match[1]) === 9999 && monthNumber === 12) {
    throw new Error(`Invalid year-month: ${month}`);
  }
  const startAttendanceDateInclusive = `${match[1]}-${match[2]}-01`;
  const nextMonth = new Date(0);
  nextMonth.setUTCFullYear(Number(match[1]), monthNumber, 0);
  nextMonth.setUTCHours(0, 0, 0, 0);
  return {
    startAttendanceDateInclusive,
    endAttendanceDateInclusive: nextMonth.toISOString().slice(0, 10),
  };
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

export function createPayrollEstimateApplication(dependencies: {
  attendance: PayrollEstimateAttendanceQueryPort;
  unitOfWork: PayrollUnitOfWork;
}) {
  const { attendance, unitOfWork } = dependencies;
  return {
    async getMonthlyPayrollEstimateSummary(actorUserId: string, month: string) {
      const { startAttendanceDateInclusive, endAttendanceDateInclusive } =
        getMonthDateRange(month);
      return unitOfWork.run(async ({ users, hourlyWageRuleReadStore }) => {
        const actor = await users.getUserById(actorUserId);
        const authorization = authorizeActiveAdmin(actor);
        if (!authorization.ok)
          throw new PayrollEstimateForbiddenError(
            authorization.code === "SESSION_EXPIRED"
              ? "ACTOR_NOT_ACTIVE"
              : authorization.code,
          );
        const states = await attendance.getPayrollProjectionStates({
          startAttendanceDateInclusive,
          endAttendanceDateInclusive,
        });
        const visibleUserIds = [
          ...new Set(states.map((state) => state.userId)),
        ];
        const rules = visibleUserIds.length
          ? await hourlyWageRuleReadStore.findForPayrollEstimate({
              userIds: visibleUserIds,
              startAttendanceDateInclusive,
              endAttendanceDateInclusive,
            })
          : [];
        return {
          month,
          summaries: summarizeMonthlyPayrollEstimate(
            buildPayrollEstimateAttendances(states, rules, month),
            month,
          ),
        };
      });
    },
    async getUserMonthlyPayrollEstimateDetail(
      actorUserId: string,
      userId: string,
      month: string,
    ): Promise<UserMonthlyPayrollEstimateDetail> {
      const { startAttendanceDateInclusive, endAttendanceDateInclusive } =
        getMonthDateRange(month);
      return unitOfWork.run(async ({ users, hourlyWageRuleReadStore }) => {
        const actor = await users.getUserById(actorUserId);
        const authorization = authorizeActiveAdmin(actor);
        if (!authorization.ok)
          throw new PayrollEstimateForbiddenError(
            authorization.code === "SESSION_EXPIRED"
              ? "ACTOR_NOT_ACTIVE"
              : authorization.code,
          );
        const target = await users.getUserById(userId);
        if (!target) throw new PayrollEstimateTargetUserNotFoundError();
        const states = await attendance.getPayrollProjectionStates(
          {
            userId,
            startAttendanceDateInclusive,
            endAttendanceDateInclusive,
          },
          userId,
        );
        const rules = await hourlyWageRuleReadStore.findForPayrollEstimate({
          userIds: [userId],
          startAttendanceDateInclusive,
          endAttendanceDateInclusive,
        });
        const detail = calculateUserMonthlyPayrollEstimateDetail(
          buildPayrollEstimateAttendanceDetails(states, rules, month).sort(
            compareAttendance,
          ),
          month,
          userId,
        );
        return {
          ...detail,
          displayName: target.displayName,
        };
      });
    },
    async getAttendancePayrollEstimate(
      actorUserId: string,
      state: PayrollEstimateAttendanceSnapshot,
    ) {
      return unitOfWork.run(async ({ users, hourlyWageRuleReadStore }) => {
        const actor = await users.getUserById(actorUserId);
        const authorization = authorizeActiveAdmin(actor);
        if (!authorization.ok)
          throw new PayrollEstimateForbiddenError(
            authorization.code === "SESSION_EXPIRED"
              ? "ACTOR_NOT_ACTIVE"
              : authorization.code,
          );
        const target = await users.getUserById(state.userId);
        if (!target) throw new PayrollEstimateTargetUserNotFoundError();
        if (state.cancelled)
          return {
            hourlyWage: null,
            estimatedPayYen: null,
            status: "excluded" as const,
          };
        const rules = await hourlyWageRuleReadStore.findForPayrollEstimate({
          userIds: [state.userId],
          startAttendanceDateInclusive: state.attendanceDate,
          endAttendanceDateInclusive: state.attendanceDate,
        });
        const [item] = buildPayrollEstimateAttendanceDetails(
          [state],
          rules,
          state.attendanceDate.slice(0, 7),
        );
        const calculated = calculateUserMonthlyPayrollEstimateDetail(
          item ? [item] : [],
          state.attendanceDate.slice(0, 7),
          state.userId,
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
      });
    },
  };
}

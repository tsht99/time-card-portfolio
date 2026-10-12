import "server-only";

import {
  type AttendanceApplicationActor,
  createAttendanceApplication,
} from "@repo/attendance";
import { PostgresAttendanceCurrentStateReadModel } from "@repo/attendance/infrastructure";
import {
  createAttendancePayrollProjectionReader,
  PostgresAttendanceEventStore,
} from "@repo/attendance/internal";
import { getDatabase } from "@repo/db";
import type {
  PayrollUnitOfWork,
  PayrollUserReferenceReader,
} from "@repo/payroll";

export { PayrollEstimateForbiddenError } from "@repo/payroll";

import {
  createPayrollEstimateApplication,
  createHourlyWageRuleManagementApplication as createPayrollHourlyWageRuleManagementApplication,
  PayrollEstimateTargetUserNotFoundError,
} from "@repo/payroll";
import {
  PostgresHourlyWageRuleManagementPersistenceAdapter,
  PostgresHourlyWageRuleReadStore,
} from "@repo/payroll/infrastructure";
import { users } from "@repo/users/schema";
import { eq } from "drizzle-orm";
import { PostgresAttendanceEventStoreUnitOfWork } from "./attendance-composition";
import { createTimeCardUserReadApplication } from "./users-composition";

function createPayrollUnitOfWork(
  db: ReturnType<typeof getDatabase>,
): PayrollUnitOfWork {
  return {
    async run(operation) {
      return db.transaction(async (tx) => {
        const references: PayrollUserReferenceReader = {
          async getUserById(userId) {
            const [row] = await tx
              .select({
                userId: users.id,
                role: users.role,
                status: users.status,
                displayName: users.displayName,
              })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1);
            return row ?? null;
          },
          async getUsers() {
            return tx
              .select({
                userId: users.id,
                role: users.role,
                status: users.status,
                displayName: users.displayName,
              })
              .from(users);
          },
        };
        return operation({
          users: references,
          hourlyWageRuleManagementPersistence:
            new PostgresHourlyWageRuleManagementPersistenceAdapter(tx, true),
          hourlyWageRuleReadStore: new PostgresHourlyWageRuleReadStore(tx),
        });
      });
    },
  };
}

export function isPayrollEstimateTargetUserNotFoundError(error: unknown) {
  return error instanceof PayrollEstimateTargetUserNotFoundError;
}

export function createHourlyWageRuleManagementApplication() {
  const db = getDatabase();
  return createPayrollHourlyWageRuleManagementApplication({
    unitOfWork: createPayrollUnitOfWork(db),
  });
}

export function createAdminPayrollEstimateQueries() {
  const db = getDatabase();
  const userReferences = createTimeCardUserReadApplication();
  const attendanceDependencies = {
    eventStore: new PostgresAttendanceEventStore(db),
    currentStateReadModel: new PostgresAttendanceCurrentStateReadModel(db),
    userReferences,
    transactionUnitOfWork: new PostgresAttendanceEventStoreUnitOfWork(db),
  };
  const attendance = createAttendanceApplication(attendanceDependencies);
  const attendanceProjectionReader = createAttendancePayrollProjectionReader(
    attendanceDependencies,
  );
  const payrollEstimate = createPayrollEstimateApplication({
    attendance: attendanceProjectionReader,
    unitOfWork: createPayrollUnitOfWork(db),
  });
  return {
    getMonthlyPayrollEstimateSummary:
      payrollEstimate.getMonthlyPayrollEstimateSummary,
    getUserMonthlyPayrollEstimateDetail:
      payrollEstimate.getUserMonthlyPayrollEstimateDetail,
    async getAdminAttendanceDetailWithPayrollEstimate(
      actor: AttendanceApplicationActor,
      attendanceId: string,
    ) {
      const detail = await attendance.getAdminAttendanceDetail(
        actor,
        attendanceId,
      );
      const payrollEstimateDetail =
        await payrollEstimate.getAttendancePayrollEstimate(actor.userId, {
          attendanceId: detail.attendanceId,
          userId: detail.userId,
          attendanceDate: detail.attendanceDate,
          workPeriod: detail.workPeriod,
          clockInAt: new Date(detail.clockInAt),
          clockOutAt:
            detail.clockOutAt === null ? null : new Date(detail.clockOutAt),
          cancelled: detail.status === "cancelled",
        });
      return { ...detail, payrollEstimate: payrollEstimateDetail };
    },
  };
}

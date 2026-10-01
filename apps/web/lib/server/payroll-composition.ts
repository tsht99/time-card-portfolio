import "server-only";

import { createAttendanceApplication as createAttendanceUseCases } from "@repo/attendance";
import {
  PostgresAttendanceCurrentStateReadModel,
  PostgresAttendanceEventStore,
} from "@repo/attendance/infrastructure";
import { getDatabase } from "@repo/db";
import {
  createAttendancePayrollApplication,
  createHourlyWageRateManagementApplication as createPayrollWageApplication,
  PayrollTargetUserNotFoundError,
} from "@repo/payroll";
import {
  PostgresHourlyWageRatePersistenceAdapter,
  PostgresHourlyWageRateStore,
} from "@repo/payroll/infrastructure";
import { createTimeCardUserReadApplication } from "./users-access";

export function isPayrollTargetUserNotFoundError(error: unknown) {
  return error instanceof PayrollTargetUserNotFoundError;
}

export function createHourlyWageRateManagementApplication() {
  const db = getDatabase();
  const userReferences = createTimeCardUserReadApplication();
  return createPayrollWageApplication({
    userReferences,
    hourlyWageRatePersistence: new PostgresHourlyWageRatePersistenceAdapter(db),
  });
}

export function createAdminPayrollQueries() {
  const db = getDatabase();
  const userReferences = createTimeCardUserReadApplication();
  const attendance = createAttendanceUseCases({
    eventStore: new PostgresAttendanceEventStore(db),
    currentStateReadModel: new PostgresAttendanceCurrentStateReadModel(db),
    userReferences,
  });
  const payroll = createAttendancePayrollApplication({
    attendance,
    hourlyWageRateStore: new PostgresHourlyWageRateStore(db),
    userReferences,
  });
  return {
    getMonthlyPayrollSummary: payroll.getMonthlyPayrollSummary,
    getUserMonthlyPayrollDetail: payroll.getUserMonthlyPayrollDetail,
    async getAdminAttendanceDetailWithPayroll(attendanceId: string) {
      const [detail, payrollDetail] = await Promise.all([
        attendance.getAdminAttendanceDetail(attendanceId),
        payroll.getAttendancePayrollEstimate(attendanceId),
      ]);
      return { ...detail, payroll: payrollDetail };
    },
  };
}

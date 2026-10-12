import type { PayrollEstimateAttendanceInput } from "../monthly-payroll-estimate.ts";

export type PayrollEstimateAttendanceQueryPort = {
  getPayrollProjectionStates(
    query: {
      startAttendanceDateInclusive: string;
      endAttendanceDateInclusive: string;
      userId?: string;
    },
    fallbackUserId?: string,
  ): Promise<readonly PayrollEstimateAttendanceInput[]>;
};

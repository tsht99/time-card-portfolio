import type { UserMonthlyPayrollEstimateDetail } from "@repo/payroll";
import { z } from "zod";
import { yearMonthSchema } from "./attendance-query.ts";

export type { UserMonthlyPayrollEstimateSummary } from "@repo/payroll";

export type AdminUserMonthlyPayrollEstimateDetail = Omit<
  UserMonthlyPayrollEstimateDetail,
  "attendances"
> & {
  attendances: Array<
    Omit<
      UserMonthlyPayrollEstimateDetail["attendances"][number],
      "clockInAt" | "clockOutAt"
    > & {
      clockInAt: string | null;
      clockOutAt: string | null;
    }
  >;
};

export const monthlyPayrollEstimateSummaryQuerySchema = z.object({
  month: yearMonthSchema,
});

export const adminUserMonthlyPayrollEstimateDetailQuerySchema = z
  .object({
    month: yearMonthSchema,
    userId: z.uuid("userId はUUID形式で指定してください。"),
  })
  .strict();

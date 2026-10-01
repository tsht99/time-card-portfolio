// cspell:ignore uncomputed

import type {
  UserMonthlyPayrollSummary as PayrollUserMonthlyPayrollSummary,
  UserMonthlyPayrollDetail,
} from "@repo/payroll";
import { z } from "zod";
import { yearMonthSchema } from "./attendance-query.ts";

export type UserMonthlyPayrollSummary = PayrollUserMonthlyPayrollSummary;

export type AdminUserMonthlyPayrollDetail = Omit<
  UserMonthlyPayrollDetail,
  "attendances"
> & {
  displayName: string | null;
  attendances: Array<
    Omit<
      UserMonthlyPayrollDetail["attendances"][number],
      "clockInAt" | "clockOutAt"
    > & {
      clockInAt: string | null;
      clockOutAt: string | null;
    }
  >;
};

export const monthlyPayrollSummaryQuerySchema = z.object({
  month: yearMonthSchema,
});

export const adminUserMonthlyPayrollDetailQuerySchema = z
  .object({
    month: yearMonthSchema,
    userId: z.string().uuid("userId はUUID形式で指定してください。"),
  })
  .strict();

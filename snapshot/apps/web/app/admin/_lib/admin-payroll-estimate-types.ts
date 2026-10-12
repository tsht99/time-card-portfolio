import type {
  AdminUserMonthlyPayrollEstimateDetail,
  UserMonthlyPayrollEstimateSummary,
} from "@repo/contracts";
import type { AdminReadState } from "./admin-read-state.ts";

export type AdminMonthlyPayrollEstimateSummaryState = AdminReadState<
  UserMonthlyPayrollEstimateSummary[]
>;
export type AdminUserMonthlyPayrollEstimateDetailState =
  AdminReadState<AdminUserMonthlyPayrollEstimateDetail>;

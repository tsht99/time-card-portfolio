"use client";

import type { UserMonthlyPayrollSummary } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type { AdminMonthlyPayrollSummaryState } from "../../../lib/admin-attendance-types";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { isValidMonth } from "../../../lib/month";
import { getAdminMonthlyPayrollSummaryAction } from "../_actions/attendance-actions.ts";
import { useAuth } from "../_components/auth-provider.tsx";
import {
  type AdminClientError,
  clientErrorFromReadState,
  readAdminState,
} from "../_lib/admin-action-client.ts";

type Summary = UserMonthlyPayrollSummary;

import { PayrollListView } from "./payroll-list-view";

const queryKeys = {
  summary: (month: string) => ["payroll", "list", month] as const,
};
async function readSummary(month: string, reauthenticate: () => Promise<void>) {
  const state = await readAdminState(
    () => getAdminMonthlyPayrollSummaryAction({ month }),
    reauthenticate,
  );
  if (state.status !== "ready") throw clientErrorFromReadState(state);
  return state.data;
}
export function PayrollListClient({
  initialMonth,
  fallbackMonth = initialMonth,
  initialSummary,
  initialUsers,
}: {
  initialMonth: string;
  fallbackMonth?: string;
  initialSummary: AdminMonthlyPayrollSummaryState;
  initialUsers: AdminUsersState;
}) {
  const { authState, reauthenticate } = useAuth();
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get("month");
  const month = urlMonth ?? fallbackMonth;
  function navigateToMonth(targetMonth: string) {
    if (!isValidMonth(targetMonth) || targetMonth === month) return;
    window.history.pushState(
      null,
      "",
      `/admin/payroll?month=${encodeURIComponent(targetMonth)}`,
    );
  }
  const summaryQuery = useQuery<Summary[], AdminClientError>({
    queryKey: queryKeys.summary(month),
    queryFn: () => readSummary(month, reauthenticate),
    enabled:
      authState.status === "ready" &&
      isValidMonth(month) &&
      month !== initialMonth,
    retry: false,
  });
  const isValidSelectedMonth = isValidMonth(month);
  const initialData =
    initialSummary.status === "ready" ? initialSummary.data : [];
  const summaries =
    isValidSelectedMonth && month === initialMonth
      ? initialData
      : isValidSelectedMonth && summaryQuery.isSuccess
        ? summaryQuery.data
        : [];
  const sortedSummaries = [...summaries].sort(
    (left, right) =>
      right.totalEstimatedPayYen - left.totalEstimatedPayYen ||
      left.userId.localeCompare(right.userId),
  );
  const error =
    month === initialMonth && initialSummary.status !== "ready"
      ? initialSummary
      : summaryQuery.error;
  const pending =
    isValidSelectedMonth && month !== initialMonth && summaryQuery.isPending;
  const usersById = new Map(
    (initialUsers.status === "ready" ? initialUsers.data : []).map((user) => [
      user.userId,
      user,
    ]),
  );
  const userResolutionError =
    initialUsers.status !== "ready"
      ? initialUsers.message
      : summaries.some((summary) => {
            const user = usersById.get(summary.userId);
            return user === undefined || user.displayName === null;
          })
        ? "スタッフ名を取得できない給与データがあります。"
        : null;
  const canDisplaySummaries = userResolutionError === null;
  return (
    <PayrollListView
      authState={authState}
      month={month}
      navigateToMonth={navigateToMonth}
      initialUsers={initialUsers}
      pending={pending}
      error={error ? { message: error.message } : null}
      isValidSelectedMonth={isValidSelectedMonth}
      userResolutionError={userResolutionError}
      summaries={summaries}
      sortedSummaries={sortedSummaries}
      canDisplaySummaries={canDisplaySummaries}
    />
  );
}

"use client";

import { useQueryState } from "nuqs";
import { isValidMonth } from "../../../../lib/month";
import { monthParser } from "../../../../lib/month-query-state";
import { useAuth } from "../../_components/auth-provider.tsx";
import type { AdminMonthlyPayrollEstimateSummaryState } from "../../_lib/admin-payroll-estimate-types.ts";
import type { AdminUserListState } from "../../_lib/admin-user-management-types.ts";

import { PayrollEstimateListView } from "./list-view";

export function PayrollEstimateListClient({
  initialMonth,
  fallbackMonth = initialMonth,
  initialSummary,
  initialUsers,
}: {
  initialMonth: string;
  fallbackMonth?: string;
  initialSummary: AdminMonthlyPayrollEstimateSummaryState;
  initialUsers: AdminUserListState;
}) {
  const { authState } = useAuth();
  const [urlMonth, setUrlMonth] = useQueryState(
    "month",
    monthParser.withOptions({ history: "push", shallow: false, scroll: false }),
  );
  const month = urlMonth ?? fallbackMonth;
  function navigateToMonth(targetMonth: string) {
    if (!isValidMonth(targetMonth) || targetMonth === month) return;
    void setUrlMonth(targetMonth);
  }
  const isValidSelectedMonth = isValidMonth(month);
  const initialData =
    initialSummary.status === "ready" ? initialSummary.data : [];
  const dataMatchesMonth = month === initialMonth;
  const summaries = isValidSelectedMonth && dataMatchesMonth ? initialData : [];
  const sortedSummaries = [...summaries].sort(
    (left, right) =>
      right.totalEstimatedPayYen - left.totalEstimatedPayYen ||
      left.userId.localeCompare(right.userId),
  );
  const error =
    dataMatchesMonth && initialSummary.status !== "ready"
      ? initialSummary
      : null;
  const pending = isValidSelectedMonth && !dataMatchesMonth;
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
        ? "スタッフ名を取得できない給与見込みデータがあります。"
        : null;
  const canDisplaySummaries = userResolutionError === null;
  return (
    <PayrollEstimateListView
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

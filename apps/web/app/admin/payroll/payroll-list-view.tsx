"use client";

import type { UserMonthlyPayrollSummary } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { AlertTriangle } from "lucide-react";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { isValidMonth } from "../../../lib/month";
import { MonthNavigation } from "../../_components/month-navigation.tsx";
import {
  NavigationList,
  NavigationListItem,
} from "../_components/navigation-list.tsx";

type AuthState =
  | {
      status: "checking" | "error" | "unavailable";
      message: string;
    }
  | {
      status: "ready";
      message?: string;
    };
type Summary = UserMonthlyPayrollSummary;
function formatYen(value: number) {
  return `${value.toLocaleString("ja-JP")}円`;
}
function SummaryRow({
  summary,
  displayName,
  month,
}: {
  summary: Summary;
  displayName: string;
  month: string;
}) {
  const warning =
    summary.hasWorkingAttendance ||
    summary.otherIncompleteCount > 0 ||
    summary.missingHourlyWageCount > 0;
  return (
    <NavigationListItem
      href={`/admin/users/${encodeURIComponent(summary.userId)}/payroll?month=${encodeURIComponent(month)}`}
      aria-label={`${displayName}の給与詳細へ移動`}
      className="min-h-16 items-start gap-3"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 flex-1 truncate text-base font-medium">
          {displayName}
        </h2>
        {warning && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex shrink-0 items-center gap-1 text-amber-700">
              <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
              <span>要確認</span>
            </span>
          </div>
        )}
      </div>
      <p className="shrink-0 text-right font-medium tabular-nums">
        <span className="sr-only">給与見込み </span>
        {formatYen(summary.totalEstimatedPayYen)}
      </p>
    </NavigationListItem>
  );
}

export function PayrollListView({
  authState,
  month,
  navigateToMonth,
  initialUsers,
  pending,
  error,
  isValidSelectedMonth,
  userResolutionError,
  summaries,
  sortedSummaries,
  canDisplaySummaries,
}: {
  authState: AuthState;
  month: string;
  navigateToMonth: (month: string) => void;
  initialUsers: AdminUsersState;
  pending: boolean;
  error: { message: string } | null;
  isValidSelectedMonth: boolean;
  userResolutionError: string | null;
  summaries: Summary[];
  sortedSummaries: Summary[];
  canDisplaySummaries: boolean;
}) {
  const usersById = new Map(
    (initialUsers.status === "ready" ? initialUsers.data : []).map((user) => [
      user.userId,
      user,
    ]),
  );
  return (
    <main className="w-full min-w-0 text-zinc-950">
      <section className="w-full min-w-0 p-4">
        {authState.status === "checking" && <p>{authState.message}</p>}
        {(authState.status === "error" ||
          authState.status === "unavailable") && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{authState.message}</AlertDescription>
          </Alert>
        )}
        {authState.status === "ready" && (
          <>
            <div className="flex min-w-0 w-full justify-center">
              <MonthNavigation
                selectedMonth={month}
                ariaLabel="給与一覧の月ナビゲーション"
                onMonthChange={navigateToMonth}
                allowDirectSelection
              />
            </div>
            {!isValidMonth(month) && (
              <Alert className="mt-4" variant="warning">
                <AlertDescription>
                  対象月を正しく選択してください。
                </AlertDescription>
              </Alert>
            )}
            {userResolutionError && (
              <Alert className="mt-4" variant="destructive">
                <AlertDescription>{userResolutionError}</AlertDescription>
              </Alert>
            )}
            {pending && (
              <p className="mt-6 text-sm text-zinc-600" role="status">
                給与一覧を読み込み中
              </p>
            )}
            {error && (
              <Alert className="mt-6" variant="destructive">
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
            {!pending &&
              !error &&
              isValidSelectedMonth &&
              canDisplaySummaries &&
              summaries.length === 0 && (
                <p className="mt-6 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
                  この月の勤怠データはありません
                </p>
              )}
            {!pending &&
              !error &&
              isValidSelectedMonth &&
              canDisplaySummaries &&
              sortedSummaries.length > 0 && (
                <NavigationList className="mt-4" aria-label="給与一覧">
                  {sortedSummaries.map((summary) => (
                    <SummaryRow
                      key={summary.userId}
                      summary={summary}
                      month={month}
                      displayName={
                        usersById.get(summary.userId)?.displayName ?? ""
                      }
                    />
                  ))}
                </NavigationList>
              )}
          </>
        )}
      </section>
    </main>
  );
}

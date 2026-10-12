"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { useQueryState } from "nuqs";
import { isValidMonth } from "../../../../../../lib/month";
import { payrollDetailMonthParser } from "../../../../../../lib/month-query-state";
import { useAuth } from "../../../../_components/auth-provider.tsx";
import type { AdminUserMonthlyPayrollEstimateDetailState } from "../../../../_lib/admin-payroll-estimate-types.ts";
import { PayrollEstimateDetailView } from "./detail-view";

export function PayrollEstimateDetailClient({
  initialMonth,
  fallbackMonth = initialMonth,
  initialDetail,
  inputError,
}: {
  initialMonth: string;
  fallbackMonth?: string;
  initialDetail: AdminUserMonthlyPayrollEstimateDetailState;
  inputError?: string;
}) {
  const { authState } = useAuth();
  const [urlMonth, setUrlMonth] = useQueryState(
    "month",
    payrollDetailMonthParser,
  );
  const month = inputError ? "" : (urlMonth ?? fallbackMonth);
  const isValidSelectedMonth = isValidMonth(month);
  const dataMatchesMonth = month === initialMonth;

  function navigateToMonth(targetMonth: string) {
    if (!isValidMonth(targetMonth) || targetMonth === month) return;
    void setUrlMonth(targetMonth);
  }

  if (authState.status === "checking") {
    return (
      <main className="w-full min-w-0 text-zinc-950">
        <section className="w-full min-w-0 p-4">
          <p>{authState.message}</p>
        </section>
      </main>
    );
  }

  if (authState.status === "error" || authState.status === "unavailable") {
    return (
      <main className="w-full min-w-0 text-zinc-950">
        <section className="w-full min-w-0 p-4">
          <Alert variant="destructive">
            <AlertDescription>{authState.message}</AlertDescription>
          </Alert>
        </section>
      </main>
    );
  }

  const state = dataMatchesMonth ? initialDetail : undefined;
  const detailMonthMatches =
    state?.status !== "ready" || state.data.month === month;
  const loading = !dataMatchesMonth || !detailMonthMatches;
  const actionError = false;

  return (
    <main className="w-full min-w-0 text-zinc-950">
      <section className="w-full min-w-0 p-4">
        {inputError && (
          <Alert variant="warning">
            <AlertDescription>{inputError}</AlertDescription>
          </Alert>
        )}
        {!inputError && !isValidSelectedMonth && (
          <Alert variant="warning">
            <AlertDescription>
              対象月を正しく指定してください。
            </AlertDescription>
          </Alert>
        )}
        {!inputError && isValidSelectedMonth && (
          <PayrollEstimateDetailView
            state={state}
            month={month}
            loading={loading}
            hasError={Boolean(actionError)}
            navigateToMonth={navigateToMonth}
          />
        )}
      </section>
    </main>
  );
}

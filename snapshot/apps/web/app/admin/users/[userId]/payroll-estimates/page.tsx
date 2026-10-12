import { adminUserMonthlyPayrollEstimateDetailQuerySchema } from "@repo/contracts";
import { getCurrentMonth } from "../../../../../lib/month";
import { parseMonthQuery } from "../../../../../lib/month-query-state";
import { loadAdminUserMonthlyPayrollEstimateDetail } from "../../../_lib/admin-payroll-estimate.ts";
import { PayrollEstimateDetailClient } from "./_components/detail-client";

type SearchParams = {
  month?: string | string[];
};

function isValidUserId(value: string) {
  return adminUserMonthlyPayrollEstimateDetailQuerySchema.shape.userId.safeParse(
    value,
  ).success;
}

export default async function MonthlyPayrollEstimateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const [{ userId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as SearchParams),
  ]);
  const fallbackMonth = getCurrentMonth();
  const requestedMonth = resolvedSearchParams.month;
  const hasRequestedMonth = requestedMonth !== undefined;
  const validUserId = isValidUserId(userId);
  const parsedRequestedMonth = parseMonthQuery(requestedMonth);
  const validRequestedMonth = parsedRequestedMonth !== null;
  const initialMonth = parsedRequestedMonth ?? fallbackMonth;

  if (!validUserId || (hasRequestedMonth && !validRequestedMonth)) {
    const message = !validUserId
      ? "対象ユーザーを正しく指定してください。"
      : "対象月を正しく指定してください。";
    return (
      <PayrollEstimateDetailClient
        initialMonth={initialMonth}
        fallbackMonth={fallbackMonth}
        initialDetail={{ status: "error", message }}
        inputError={message}
      />
    );
  }

  const initialDetail = await loadAdminUserMonthlyPayrollEstimateDetail(
    userId,
    initialMonth,
  );

  return (
    <PayrollEstimateDetailClient
      initialMonth={initialMonth}
      fallbackMonth={fallbackMonth}
      initialDetail={initialDetail}
    />
  );
}

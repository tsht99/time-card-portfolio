import { adminUserMonthlyPayrollDetailQuerySchema } from "@repo/contracts";
import { getCurrentMonth } from "../../../../../lib/month";
import { loadAdminUserMonthlyPayrollDetail } from "../../../../../lib/server/admin-attendance";
import { PayrollDetailClient } from "./payroll-detail-client";

type SearchParams = {
  month?: string | string[];
};

function isValidUserId(value: string) {
  return adminUserMonthlyPayrollDetailQuerySchema.shape.userId.safeParse(value)
    .success;
}

function isValidMonth(value: unknown) {
  if (typeof value !== "string") return false;
  if (
    !adminUserMonthlyPayrollDetailQuerySchema.shape.month.safeParse(value)
      .success
  ) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  return year >= 1 && year <= 9999;
}

export default async function MonthlyPayrollDetailPage({
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
  const validRequestedMonth = isValidMonth(requestedMonth);
  const initialMonth =
    typeof requestedMonth === "string" && validRequestedMonth
      ? requestedMonth
      : fallbackMonth;

  if (!validUserId || (hasRequestedMonth && !validRequestedMonth)) {
    const message = !validUserId
      ? "対象ユーザーを正しく指定してください。"
      : "対象月を正しく指定してください。";
    return (
      <PayrollDetailClient
        initialMonth={initialMonth}
        fallbackMonth={fallbackMonth}
        initialDetail={{ status: "error", message }}
        userId={userId}
        inputError={message}
      />
    );
  }

  const initialDetail = await loadAdminUserMonthlyPayrollDetail(
    userId,
    initialMonth,
  );

  return (
    <PayrollDetailClient
      initialMonth={initialMonth}
      fallbackMonth={fallbackMonth}
      initialDetail={initialDetail}
      userId={userId}
    />
  );
}

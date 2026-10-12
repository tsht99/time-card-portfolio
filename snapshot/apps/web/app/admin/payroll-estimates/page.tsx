import { redirect } from "next/navigation";
import { getCurrentMonth } from "../../../lib/month";
import { parseMonthQuery } from "../../../lib/month-query-state";
import { loadAdminMonthlyPayrollEstimateSummary } from "../_lib/admin-payroll-estimate.ts";
import { loadAdminUsers } from "../_lib/admin-user-management.ts";
import { PayrollEstimateListClient } from "./_components/list-client";

type SearchParams = {
  month?: string | string[];
};

export default async function PayrollEstimateListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const fallbackMonth = getCurrentMonth();
  const month = (await searchParams).month;
  const parsedMonth = parseMonthQuery(month);

  if (month !== undefined && parsedMonth === null) {
    redirect("/admin/payroll-estimates");
  }

  const initialMonth = parsedMonth ?? fallbackMonth;
  const [initialSummary, initialUsers] = await Promise.all([
    loadAdminMonthlyPayrollEstimateSummary(initialMonth),
    loadAdminUsers(),
  ]);
  return (
    <PayrollEstimateListClient
      initialMonth={initialMonth}
      fallbackMonth={fallbackMonth}
      initialSummary={initialSummary}
      initialUsers={initialUsers}
    />
  );
}

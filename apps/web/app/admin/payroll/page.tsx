import { monthlyPayrollSummaryQuerySchema } from "@repo/contracts";
import { redirect } from "next/navigation";
import { getCurrentMonth } from "../../../lib/month";
import { loadAdminMonthlyPayrollSummary } from "../../../lib/server/admin-attendance";
import { loadAdminUsers } from "../../../lib/server/admin-user-management";
import { PayrollListClient } from "./payroll-list-client";

type SearchParams = {
  month?: string | string[];
};

export default async function PayrollListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const fallbackMonth = getCurrentMonth();
  const month = (await searchParams).month;
  const isValidMonth =
    typeof month === "string" &&
    monthlyPayrollSummaryQuerySchema.shape.month.safeParse(month).success &&
    Number(month.slice(0, 4)) >= 1 &&
    Number(month.slice(0, 4)) <= 9999;

  if (month !== undefined && !isValidMonth) {
    redirect("/admin/payroll");
  }

  const initialMonth = typeof month === "string" ? month : fallbackMonth;
  const [initialSummary, initialUsers] = await Promise.all([
    loadAdminMonthlyPayrollSummary(initialMonth),
    loadAdminUsers(),
  ]);
  return (
    <PayrollListClient
      initialMonth={initialMonth}
      fallbackMonth={fallbackMonth}
      initialSummary={initialSummary}
      initialUsers={initialUsers}
    />
  );
}

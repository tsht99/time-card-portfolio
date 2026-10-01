import { createHourlyWageRateRequestSchema } from "@repo/payroll/contracts";
import { redirect } from "next/navigation";
import { loadAdminUsers } from "../../../../../lib/server/admin-user-management";
import { HourlyWageRatesClient } from "./hourly-wage-rates-client.tsx";

export default async function UserHourlyWageRatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<{ date?: string | string[] }>;
}) {
  const [{ userId }, resolvedSearchParams, initialUsers] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as { date?: string | string[] }),
    loadAdminUsers(),
  ]);
  const requestedDate = resolvedSearchParams.date;
  if (
    requestedDate !== undefined &&
    (typeof requestedDate !== "string" ||
      !createHourlyWageRateRequestSchema.shape.effectiveFrom.safeParse(
        requestedDate,
      ).success)
  ) {
    redirect(`/admin/users/${encodeURIComponent(userId)}/hourly-wage-rates`);
  }
  return (
    <HourlyWageRatesClient
      key={`${userId}:${requestedDate ?? "current"}`}
      initialUsers={initialUsers}
      selectedUserId={userId}
      initialReferenceDate={requestedDate}
    />
  );
}

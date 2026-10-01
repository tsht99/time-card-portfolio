import { loadAdminUsers } from "../../../../../../lib/server/admin-user-management";
import { HourlyWageHistory } from "./hourly-wage-history";

export default async function HourlyWageHistoryPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const [{ userId }, initialUsers] = await Promise.all([
    params,
    loadAdminUsers(),
  ]);
  return (
    <HourlyWageHistory
      key={userId}
      initialUsers={initialUsers}
      userId={userId}
    />
  );
}

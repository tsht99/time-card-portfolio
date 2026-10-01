import { getCurrentMonth } from "../../../../lib/month";
import { loadAdminUsers } from "../../../../lib/server/admin-user-management";
import { getServerReferenceTime } from "../../../../lib/server/reference-time";
import { UserDetail } from "./user-detail";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const initialUsers = await loadAdminUsers();

  return (
    <UserDetail
      key={userId}
      initialUsers={initialUsers}
      userId={userId}
      currentMonth={getCurrentMonth(getServerReferenceTime())}
    />
  );
}

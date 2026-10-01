import { loadAdminUsers } from "../../../lib/server/admin-user-management";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const initialUsers = await loadAdminUsers();
  return <UsersClient initialUsers={initialUsers} />;
}

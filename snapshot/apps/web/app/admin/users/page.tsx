import { loadAdminUsers } from "../_lib/admin-user-management.ts";
import { UsersClient } from "./_components/users-client";

export default async function UsersPage() {
  const initialUsers = await loadAdminUsers();
  return <UsersClient initialUsers={initialUsers} />;
}

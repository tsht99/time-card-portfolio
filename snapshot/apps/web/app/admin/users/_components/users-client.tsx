"use client";

import { useAuth } from "../../_components/auth-provider.tsx";
import type { AdminUserListState } from "../../_lib/admin-user-management-types.ts";
import { UsersView } from "./users-view";

export function UsersClient({
  initialUsers,
}: {
  initialUsers: AdminUserListState;
}) {
  const { authState } = useAuth();
  return <UsersView authState={authState} initialUsers={initialUsers} />;
}

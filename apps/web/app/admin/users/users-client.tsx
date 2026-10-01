"use client";

import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { useAuth } from "../_components/auth-provider.tsx";
import { UsersView } from "./users-view";

export function UsersClient({
  initialUsers,
}: {
  initialUsers: AdminUsersState;
}) {
  const { authState } = useAuth();
  return <UsersView authState={authState} initialUsers={initialUsers} />;
}

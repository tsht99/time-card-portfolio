"use client";

import type { UserListItem } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import {
  NavigationList,
  NavigationListItem,
} from "../_components/navigation-list.tsx";

type AuthState =
  | {
      status: "checking" | "error" | "unavailable";
      message: string;
    }
  | {
      status: "ready";
      message?: string;
    };
const staffStatusOrder: Record<string, number> = {
  active: 0,
  pending: 1,
  inactive: 2,
};
function statusLabel(status: string) {
  return status === "active"
    ? "利用中"
    : status === "inactive"
      ? "利用停止"
      : status === "pending"
        ? "承認待ち"
        : status;
}
function sortByUserId(left: UserListItem, right: UserListItem) {
  return left.userId.localeCompare(right.userId);
}
function sortStaff(left: UserListItem, right: UserListItem) {
  return (
    (staffStatusOrder[left.status] ?? Number.MAX_SAFE_INTEGER) -
      (staffStatusOrder[right.status] ?? Number.MAX_SAFE_INTEGER) ||
    sortByUserId(left, right)
  );
}
function UserRow({ user }: { user: UserListItem }) {
  const statusClassName =
    user.status === "active"
      ? "bg-green-100 text-green-800"
      : user.status === "inactive"
        ? "bg-zinc-100 text-zinc-700"
        : user.status === "pending"
          ? "bg-amber-100 text-amber-800"
          : "bg-zinc-100 text-zinc-700";
  return (
    <NavigationListItem
      href={`/admin/users/${encodeURIComponent(user.userId)}`}
    >
      <span className="min-w-0 flex-1 truncate text-base font-medium">
        {user.displayName ?? "名前未設定"}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName}`}
      >
        {statusLabel(user.status)}
      </span>
    </NavigationListItem>
  );
}
function UserList({ users, label }: { users: UserListItem[]; label: string }) {
  return (
    <NavigationList className="mt-3" aria-label={label}>
      {users.map((user) => (
        <UserRow key={user.userId} user={user} />
      ))}
    </NavigationList>
  );
}

export function UsersView({
  authState,
  initialUsers,
}: {
  authState: AuthState;
  initialUsers: AdminUsersState;
}) {
  const admins =
    initialUsers.status === "ready"
      ? initialUsers.data
          .filter((user) => user.role === "admin")
          .sort(sortByUserId)
      : [];
  const staff =
    initialUsers.status === "ready"
      ? initialUsers.data
          .filter((user) => user.role === "staff")
          .sort(sortStaff)
      : [];
  return (
    <main className="w-full min-w-0 text-zinc-950">
      <section className="w-full min-w-0 p-4">
        {authState.status === "checking" && <p>{authState.message}</p>}
        {(authState.status === "error" ||
          authState.status === "unavailable") && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{authState.message}</AlertDescription>
          </Alert>
        )}
        {authState.status === "ready" && (
          <>
            {initialUsers.status !== "ready" && (
              <Alert
                variant={
                  initialUsers.status === "missing" ? "warning" : "destructive"
                }
                className="mt-6"
              >
                <AlertDescription>{initialUsers.message}</AlertDescription>
              </Alert>
            )}
            {initialUsers.status === "ready" && admins.length > 0 && (
              <section className="mt-6">
                <h2 className="text-base font-semibold">管理者</h2>
                <UserList users={admins} label="管理者一覧" />
              </section>
            )}
            {initialUsers.status === "ready" && staff.length > 0 && (
              <section className="mt-6">
                <h2 className="text-base font-semibold">スタッフ</h2>
                <UserList users={staff} label="スタッフ一覧" />
              </section>
            )}
            {initialUsers.status === "ready" && staff.length === 0 && (
              <section className="mt-6">
                <h2 className="text-base font-semibold">スタッフ</h2>
                <p className="mt-3 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
                  管理対象のスタッフはいません。
                </p>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}

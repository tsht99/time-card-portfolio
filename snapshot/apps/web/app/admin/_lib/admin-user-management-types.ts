import type { UserListItem } from "@repo/contracts";

type AdminUserManagementReadState<T> =
  | { status: "ready"; data: T }
  | { status: "missing"; message: string }
  | {
      status: "unavailable";
      code: "ADMIN_ACCESS_REQUIRED" | "ACTOR_NOT_ACTIVE";
      message: string;
    }
  | { status: "error"; code?: "USER_NOT_FOUND"; message: string };

export type AdminUserListState = AdminUserManagementReadState<UserListItem[]>;

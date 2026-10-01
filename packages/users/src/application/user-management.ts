import {
  changeManagedDisplayName,
  changeStaffStatus,
  type UserState,
  type UserStatus,
} from "../domain/user.ts";
import type { UserReader, UsersUnitOfWork } from "./ports/user-persistence.ts";

export type UpdateUserStatusResult =
  | { kind: "success"; userId: string; status: UserStatus }
  | { kind: "not-found" }
  | { kind: "role-forbidden" }
  | { kind: "transition-forbidden" }
  | { kind: "display-name-required" }
  | { kind: "display-name-too-long" }
  | { kind: "display-name-conflict" };

export type UpdateUserDisplayNameResult =
  | { kind: "success"; userId: string; displayName: string }
  | { kind: "not-found" }
  | { kind: "role-forbidden" }
  | { kind: "display-name-required" }
  | { kind: "display-name-too-long" }
  | { kind: "display-name-conflict" };

function compareUsers(left: UserState, right: UserState): number {
  if (left.displayName === null && right.displayName !== null) return 1;
  if (left.displayName !== null && right.displayName === null) return -1;
  const byDisplayName = (left.displayName ?? "").localeCompare(
    right.displayName ?? "",
  );
  return byDisplayName || left.userId.localeCompare(right.userId);
}

export function createUserManagementApplication(
  users: UserReader,
  unitOfWork: UsersUnitOfWork,
) {
  return {
    ...createUserReadApplication(users),

    async updateUserStatus(input: {
      userId: string;
      status: UserStatus;
    }): Promise<UpdateUserStatusResult> {
      const result = await unitOfWork.run(async (transaction) => {
        const user = await transaction.lockUser(input.userId);
        if (!user) return { kind: "not-found" } as const;
        const change = changeStaffStatus(user, input.status);
        if (!change.ok) return { kind: change.reason };

        await transaction.setStatus(user.userId, change.user.status);
        if (change.user.status === "inactive") {
          await transaction.revokeSessions(user.userId);
        }
        return {
          kind: "success" as const,
          userId: user.userId,
          status: change.user.status,
        };
      });
      return result.ok ? result.value : { kind: result.reason };
    },

    async updateUserDisplayName(input: {
      actorUserId: string;
      userId: string;
      displayName: string;
    }): Promise<UpdateUserDisplayNameResult> {
      const result = await unitOfWork.run(async (transaction) => {
        const user = await transaction.lockUser(input.userId);
        if (!user) return { kind: "not-found" } as const;
        const change = changeManagedDisplayName(
          input.actorUserId,
          user,
          input.displayName,
        );
        if (!change.ok) return { kind: change.reason };

        await transaction.setDisplayName(user.userId, change.user.displayName);
        return {
          kind: "success" as const,
          userId: user.userId,
          displayName: change.user.displayName,
        };
      });
      return result.ok ? result.value : { kind: result.reason };
    },
  };
}

/** Public read boundary for role, status and display name. */
export function createUserReadApplication(users: UserReader) {
  return {
    getUserById: (userId: string) => users.findById(userId),
    async getUsers(): Promise<UserState[]> {
      return [...(await users.list())].sort(compareUsers);
    },
  };
}

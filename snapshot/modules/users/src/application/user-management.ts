import {
  canManageUsers,
  changeManagedDisplayName,
  changeStaffAccessStatus,
  type UserAccessState,
  type UserAccessStatus,
} from "../domain/user.ts";
import type {
  UserReader,
  UsersTransaction,
  UsersUnitOfWork,
} from "./ports/user-persistence.ts";

export type UpdateUserAccessStatusResult =
  | { kind: "success"; userId: string; status: UserAccessStatus }
  | { kind: "not-found" }
  | {
      kind: "actor-forbidden";
      code: "ACTOR_NOT_ACTIVE" | "ADMIN_ACCESS_REQUIRED";
    }
  | { kind: "role-forbidden" }
  | { kind: "transition-forbidden" }
  | { kind: "display-name-required" }
  | { kind: "display-name-too-long" }
  | { kind: "display-name-conflict" };

type AdminActor = Pick<UserAccessState, "userId" | "role" | "status">;

function adminActorFailureCode(
  user: AdminActor | null,
): "ACTOR_NOT_ACTIVE" | "ADMIN_ACCESS_REQUIRED" | null {
  if (user?.status !== "active") return "ACTOR_NOT_ACTIVE";
  return canManageUsers(user.role, user.status)
    ? null
    : "ADMIN_ACCESS_REQUIRED";
}

/** Authorization reads the actor without taking a lock; only the target is serialized. */
async function readActorAndLockTarget(
  transaction: UsersTransaction,
  actorUserId: string,
  targetUserId: string,
) {
  const target = await transaction.lockUser(targetUserId);
  const actor =
    actorUserId === targetUserId
      ? target
      : await transaction.readUser(actorUserId);
  return {
    actor,
    target,
  };
}

export type UpdateUserDisplayNameResult =
  | { kind: "success"; userId: string; displayName: string }
  | { kind: "not-found" }
  | {
      kind: "actor-forbidden";
      code: "ACTOR_NOT_ACTIVE" | "ADMIN_ACCESS_REQUIRED";
    }
  | { kind: "role-forbidden" }
  | { kind: "display-name-required" }
  | { kind: "display-name-too-long" }
  | { kind: "display-name-conflict" };

function compareUsers(left: UserAccessState, right: UserAccessState): number {
  if (left.displayName === null && right.displayName !== null) return 1;
  if (left.displayName !== null && right.displayName === null) return -1;
  const byDisplayName = (left.displayName ?? "").localeCompare(
    right.displayName ?? "",
  );
  return byDisplayName || left.userId.localeCompare(right.userId);
}

export function createUserManagementApplication(
  _users: UserReader,
  unitOfWork: UsersUnitOfWork,
) {
  return {
    async updateUserAccessStatus(input: {
      actorUserId: string;
      userId: string;
      status: UserAccessStatus;
    }): Promise<UpdateUserAccessStatusResult> {
      const result = await unitOfWork.run(async (transaction) => {
        const { actor, target } = await readActorAndLockTarget(
          transaction,
          input.actorUserId,
          input.userId,
        );
        const actorFailure = adminActorFailureCode(actor);
        if (actorFailure)
          return { kind: "actor-forbidden", code: actorFailure } as const;
        if (!target) return { kind: "not-found" } as const;
        const change = changeStaffAccessStatus(target, input.status);
        if (!change.ok) return { kind: change.reason };

        await transaction.setAccessStatus(target.userId, change.user.status);
        if (change.user.status === "inactive") {
          await transaction.revokeSessions(target.userId);
        }
        return {
          kind: "success" as const,
          userId: target.userId,
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
        const { actor, target } = await readActorAndLockTarget(
          transaction,
          input.actorUserId,
          input.userId,
        );
        const actorFailure = adminActorFailureCode(actor);
        if (actorFailure)
          return { kind: "actor-forbidden", code: actorFailure } as const;
        if (!target) return { kind: "not-found" } as const;
        const change = changeManagedDisplayName(
          input.actorUserId,
          target,
          input.displayName,
        );
        if (!change.ok) return { kind: change.reason };

        await transaction.setDisplayName(
          target.userId,
          change.user.displayName,
        );
        return {
          kind: "success" as const,
          userId: target.userId,
          displayName: change.user.displayName,
        };
      });
      return result.ok ? result.value : { kind: result.reason };
    },
  };
}

/** Internal cross-module reference reads; user-facing reads use protected applications. */
export function createUserReferenceApplication(users: UserReader) {
  return {
    getUserById: (userId: string) => users.findById(userId),
    async getUsers(): Promise<UserAccessState[]> {
      return [...(await users.list())].sort(compareUsers);
    },
  };
}

/** Admin reads authorize from the actor's transactional, non-locking row read. */
export function createAdminUserReadApplication(unitOfWork: UsersUnitOfWork) {
  return {
    async getUsers(actorUserId: string) {
      const result = await unitOfWork.run(async (transaction) => {
        const actor = await transaction.readUser(actorUserId);
        const actorFailure = adminActorFailureCode(actor);
        if (actorFailure)
          return { kind: "actor-forbidden", code: actorFailure } as const;
        return {
          kind: "success" as const,
          users: [...(await transaction.listUsers())].sort(compareUsers),
        };
      });
      return result.ok ? result.value : { kind: result.reason };
    },
  };
}

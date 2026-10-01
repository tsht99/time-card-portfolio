import type { PostgresDatabase } from "@repo/platform";
import { and, eq, sql } from "drizzle-orm";

import type {
  SessionReader,
  StoredSession,
  UnitOfWorkResult,
  UserReader,
  UserRegistration,
  UsersTransaction,
  UsersUnitOfWork,
} from "../../application/ports/user-persistence.ts";
import { normalizeDisplayName, type UserState } from "../../domain/user.ts";
import { authSessions } from "../../schema/auth-sessions.ts";
import { users } from "../../schema/users.ts";

const displayNameUniqueConstraint = "users_active_inactive_display_name_unique";

function isDisplayNameConflict(error: unknown): boolean {
  const visited = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    const record = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      record.code === "23505" &&
      record.constraint === displayNameUniqueConstraint
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function toUserState(row: {
  id: string;
  role: UserState["role"];
  status: UserState["status"];
  displayName: string | null;
}): UserState {
  return {
    userId: row.id,
    role: row.role,
    status: row.status,
    displayName: row.displayName,
  };
}

export type PostgresUsersAdapterConfig = {
  sessionTtlHours: number;
  now?: () => Date;
};

/** Concrete persistence adapter; every UoW callback executes in one transaction. */
export function createPostgresUsersAdapter(
  db: PostgresDatabase,
  config: PostgresUsersAdapterConfig,
): UserReader & UserRegistration & SessionReader & UsersUnitOfWork {
  const now = config.now ?? (() => new Date());
  return {
    async findById(userId) {
      const [row] = await db
        .select({
          id: users.id,
          role: users.role,
          status: users.status,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row ? toUserState(row) : null;
    },

    async list() {
      const rows = await db
        .select({
          id: users.id,
          role: users.role,
          status: users.status,
          displayName: users.displayName,
        })
        .from(users);
      return rows.map(toUserState);
    },

    async findOrCreateByLineIdentity(input) {
      const [row] = await db
        .insert(users)
        .values({
          lineUserId: input.lineUserId,
          displayName: input.displayName
            ? normalizeDisplayName(input.displayName)
            : null,
          role: input.initialRole,
          status: input.initialStatus,
        })
        .onConflictDoUpdate({
          target: users.lineUserId,
          set: { lineUserId: sql`excluded.line_user_id` },
        })
        .returning({ userId: users.id });
      if (!row) throw new Error("Failed to create or retrieve user.");
      return row;
    },

    async findSessionById(sessionId: string): Promise<StoredSession | null> {
      const [row] = await db
        .select({
          id: users.id,
          role: users.role,
          status: users.status,
          displayName: users.displayName,
          expiresAt: authSessions.expiresAt,
          revokedAt: authSessions.revokedAt,
        })
        .from(authSessions)
        .innerJoin(users, eq(authSessions.userId, users.id))
        .where(eq(authSessions.id, sessionId))
        .limit(1);
      if (!row) return null;
      return {
        user: toUserState(row),
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      };
    },

    async run<T>(
      operation: (transaction: UsersTransaction) => Promise<T>,
    ): Promise<UnitOfWorkResult<T>> {
      try {
        const value = await db.transaction(async (tx) => {
          const lockedUserIds = new Set<string>();
          const requireLock = (userId: string) => {
            if (!lockedUserIds.has(userId))
              throw new Error("User row must be locked before mutation.");
          };
          const transaction: UsersTransaction = {
            async lockUser(userId) {
              const [row] = await tx
                .select({
                  id: users.id,
                  role: users.role,
                  status: users.status,
                  displayName: users.displayName,
                })
                .from(users)
                .where(eq(users.id, userId))
                .for("update")
                .limit(1);
              if (!row) return null;
              lockedUserIds.add(userId);
              return toUserState(row);
            },
            async setStatus(userId, status) {
              requireLock(userId);
              await tx
                .update(users)
                .set({ status })
                .where(eq(users.id, userId));
            },
            async setDisplayName(userId, displayName) {
              requireLock(userId);
              await tx
                .update(users)
                .set({ displayName })
                .where(eq(users.id, userId));
            },
            async revokeSessions(userId) {
              requireLock(userId);
              await tx
                .update(authSessions)
                .set({ revokedAt: now() })
                .where(
                  and(
                    eq(authSessions.userId, userId),
                    sql`${authSessions.revokedAt} is null`,
                  ),
                );
            },
            async issueSession(userId) {
              requireLock(userId);
              const issuedAt = now();
              const expiresAt = new Date(
                issuedAt.getTime() + config.sessionTtlHours * 60 * 60 * 1000,
              );
              const sessionId = crypto.randomUUID();
              await tx.insert(authSessions).values({
                id: sessionId,
                userId,
                expiresAt,
              });
              return { sessionId, expiresAt };
            },
          };
          return operation(transaction);
        });
        return { ok: true, value };
      } catch (error) {
        if (isDisplayNameConflict(error))
          return { ok: false, reason: "display-name-conflict" };
        throw error;
      }
    },
  };
}

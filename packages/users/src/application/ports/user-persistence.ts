import type { UserRole, UserState, UserStatus } from "../../domain/user.ts";

export type StoredSession = {
  user: UserState;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** Read access shared with other business modules through the root API. */
export type UserReader = {
  findById(userId: string): Promise<UserState | null>;
  list(): Promise<UserState[]>;
};

export type SessionReader = {
  findSessionById(sessionId: string): Promise<StoredSession | null>;
};

/** Each method runs in one transaction; lockUser returns the latest row state. */
export type UsersTransaction = {
  lockUser(userId: string): Promise<UserState | null>;
  setStatus(userId: string, status: UserStatus): Promise<void>;
  setDisplayName(userId: string, displayName: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  issueSession(userId: string): Promise<{ sessionId: string; expiresAt: Date }>;
};

export type UnitOfWorkResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "display-name-conflict" };

/** The adapter commits mutations together and maps unique-name conflicts. */
export type UsersUnitOfWork = {
  run<T>(
    operation: (transaction: UsersTransaction) => Promise<T>,
  ): Promise<UnitOfWorkResult<T>>;
};

export type UserRegistration = {
  findOrCreateByLineIdentity(input: {
    lineUserId: string;
    displayName: string | null;
    initialRole: UserRole;
    initialStatus: UserStatus;
  }): Promise<{ userId: string }>;
};

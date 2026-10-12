import type {
  UserAccessState,
  UserAccessStatus,
  UserRole,
} from "../../domain/user.ts";

export type StoredSession = {
  user: UserAccessState;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** Read access shared with other business modules through the root API. */
export type UserReader = {
  findById(userId: string): Promise<UserAccessState | null>;
  list(): Promise<UserAccessState[]>;
};

export type SessionReader = {
  findSessionByCredential(credential: string): Promise<StoredSession | null>;
};

/** Each method runs in one transaction; lockUser returns the latest row state. */
export type UsersTransaction = {
  readUser(userId: string): Promise<UserAccessState | null>;
  lockUser(userId: string): Promise<UserAccessState | null>;
  listUsers(): Promise<UserAccessState[]>;
  setAccessStatus(userId: string, status: UserAccessStatus): Promise<void>;
  setDisplayName(userId: string, displayName: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  issueSession(
    userId: string,
  ): Promise<{ credential: string; expiresAt: Date }>;
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
    initialStatus: UserAccessStatus;
  }): Promise<{ userId: string }>;
};

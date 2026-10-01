import {
  isActiveAdmin,
  isActiveUser,
  isUserRole,
  isUserStatus,
  normalizeDisplayName,
  type UserRole,
} from "../domain/user.ts";
import type {
  LineIdentityFailureReason,
  LineIdentityResult,
  LineIdentityVerifier,
} from "./ports/line-identity.ts";
import type {
  SessionReader,
  UserRegistration,
  UsersUnitOfWork,
} from "./ports/user-persistence.ts";

const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthenticatedUser = {
  userId: string;
  displayName: string | null;
  role: string;
  status: string;
};

export type ActiveAuthenticatedUser = AuthenticatedUser & {
  role: UserRole;
  status: "active";
};

export type ActorAuthorizationResult =
  | { ok: true; user: ActiveAuthenticatedUser }
  | {
      ok: false;
      code: "SESSION_EXPIRED" | "ACTOR_NOT_ACTIVE" | "ADMIN_ACCESS_REQUIRED";
    };

export type LineAuthenticationInput = {
  idToken?: string | null;
  accessToken?: string | null;
};

export type LineSessionAuthenticationResult =
  | { ok: true; sessionId: string; expiresAt: Date }
  | {
      ok: false;
      code:
        | "LINE_AUTH_REQUIRED"
        | "LINE_AUTH_FAILED"
        | "USER_PENDING"
        | "USER_INACTIVE";
      message: string;
    }
  | {
      ok: false;
      code: "LINE_SERVICE_UNAVAILABLE";
      message: string;
      reason?: LineIdentityFailureReason;
    };

export type ResolveSessionResult =
  | { ok: true; user: ActiveAuthenticatedUser }
  | { ok: false; code: "SESSION_EXPIRED" };

export function authorizeActiveUser(
  user: AuthenticatedUser | null,
): ActorAuthorizationResult {
  if (!user) return { ok: false, code: "SESSION_EXPIRED" };
  if (
    !isUserRole(user.role) ||
    !isUserStatus(user.status) ||
    !isActiveUser(user.status)
  ) {
    return { ok: false, code: "ACTOR_NOT_ACTIVE" };
  }
  return { ok: true, user: { ...user, role: user.role, status: "active" } };
}

export function authorizeActiveAdmin(
  user: AuthenticatedUser | null,
): ActorAuthorizationResult {
  const active = authorizeActiveUser(user);
  if (!active.ok) return active;
  return isActiveAdmin(active.user.role, active.user.status)
    ? active
    : { ok: false, code: "ADMIN_ACCESS_REQUIRED" };
}

function chooseIdentity(
  idResult: LineIdentityResult | null,
  accessResult: LineIdentityResult | null,
): LineIdentityResult | null {
  if (idResult?.ok) return idResult;
  if (accessResult?.ok) return accessResult;
  if (accessResult && !accessResult.ok && accessResult.kind === "unavailable")
    return accessResult;
  if (idResult && !idResult.ok && idResult.kind === "unavailable")
    return idResult;
  return accessResult ?? idResult;
}

export function createAuthenticationApplication(dependencies: {
  line: LineIdentityVerifier;
  users: UserRegistration;
  sessions: SessionReader;
  unitOfWork: UsersUnitOfWork;
  now?: () => Date;
}) {
  const { line, users, sessions, unitOfWork } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  return {
    async authenticateWithLine(
      input: LineAuthenticationInput,
    ): Promise<LineSessionAuthenticationResult> {
      const idToken = input.idToken ?? null;
      const accessToken = input.accessToken ?? null;
      if (!idToken && !accessToken) {
        return {
          ok: false,
          code: "LINE_AUTH_REQUIRED",
          message: "LINE認証情報がありません。",
        };
      }

      const idResult = idToken ? await line.verifyIdToken(idToken) : null;
      const accessResult =
        accessToken && !idResult?.ok
          ? await line.verifyAccessToken(accessToken)
          : null;
      const identity = chooseIdentity(idResult, accessResult);
      if (!identity?.ok) {
        if (identity?.kind === "unavailable") {
          return {
            ok: false,
            code: "LINE_SERVICE_UNAVAILABLE",
            message: identity.message,
            ...(identity.reason ? { reason: identity.reason } : {}),
          };
        }
        return {
          ok: false,
          code: "LINE_AUTH_FAILED",
          message: identity?.message ?? "LINE認証に失敗しました。",
        };
      }

      // Keep unusable LINE names as null while preserving pending registration.
      const registered = await users.findOrCreateByLineIdentity({
        lineUserId: identity.lineUserId,
        displayName: identity.displayName
          ? normalizeDisplayName(identity.displayName)
          : null,
        initialRole: "staff",
        initialStatus: "pending",
      });
      const result = await unitOfWork.run(async (transaction) => {
        const latestUser = await transaction.lockUser(registered.userId);
        if (!latestUser)
          throw new Error("User not found while creating a session.");
        if (latestUser.status === "pending")
          return { ok: false, code: "USER_PENDING" } as const;
        if (latestUser.status === "inactive")
          return { ok: false, code: "USER_INACTIVE" } as const;
        if (!isActiveUser(latestUser.status))
          throw new Error("Unknown user status while creating a session.");
        const issued = await transaction.issueSession(latestUser.userId);
        return { ok: true, ...issued } as const;
      });
      if (!result.ok)
        throw new Error(
          "Unexpected display name conflict while issuing session.",
        );
      const session = result.value;
      if (session.ok) return session;
      return session.code === "USER_PENDING"
        ? { ok: false, code: "USER_PENDING", message: "管理者の承認待ちです。" }
        : {
            ok: false,
            code: "USER_INACTIVE",
            message: "このユーザーは利用停止中です。",
          };
    },

    async resolveActiveSession(
      sessionId: string | null | undefined,
    ): Promise<ResolveSessionResult> {
      if (!sessionId || !sessionIdPattern.test(sessionId))
        return { ok: false, code: "SESSION_EXPIRED" };
      const session = await sessions.findSessionById(sessionId);
      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= now().getTime()
      ) {
        return { ok: false, code: "SESSION_EXPIRED" };
      }
      const authorized = authorizeActiveUser(session.user);
      return authorized.ok
        ? { ok: true, user: authorized.user }
        : { ok: false, code: "SESSION_EXPIRED" };
    },
  };
}

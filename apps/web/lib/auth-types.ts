import type { ActiveAuthenticatedUser } from "@repo/users";

export type AuthenticatedTimeCardUser = ActiveAuthenticatedUser;

type ReadyAuth = {
  status: "ready";
  user: AuthenticatedTimeCardUser;
};

type MissingAuth = {
  status: "missing";
  message: string;
};

type UnavailableAuth = {
  status: "unavailable";
  code: "ADMIN_ACCESS_REQUIRED" | "ACTOR_NOT_ACTIVE";
  message: string;
};

type ErrorAuth = {
  status: "error";
  message: string;
};

export type AuthBootstrapState =
  | ReadyAuth
  | MissingAuth
  | UnavailableAuth
  | ErrorAuth;

export type LineSessionActionResult =
  | { success: true; user: AuthenticatedTimeCardUser }
  | {
      success: false;
      code:
        | "LINE_AUTH_REQUIRED"
        | "LINE_AUTH_FAILED"
        | "LINE_SERVICE_UNAVAILABLE"
        | "USER_PENDING"
        | "USER_INACTIVE"
        | "ADMIN_ACCESS_REQUIRED"
        | "ACTOR_NOT_ACTIVE"
        | "SESSION_CREATION_FAILED";
      message: string;
    };

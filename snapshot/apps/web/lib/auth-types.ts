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

export type AuthenticatedUserSessionState = Exclude<
  AuthBootstrapState,
  UnavailableAuth
>;

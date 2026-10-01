export type AdminClientErrorKind = "session" | "authorization" | "generic";

export class AdminClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly kind: AdminClientErrorKind = "generic",
  ) {
    super(message);
    this.name = "AdminClientError";
  }
}

export type AdminActionResult =
  | { success: true }
  | { success: false; code?: string; message: string };
export type AdminReadState =
  | { status: "ready"; [key: string]: unknown }
  | { status: "missing"; message: string }
  | {
      status: "unavailable" | "error";
      code?: string;
      message: string;
    };

function isActionSessionExpired(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === false &&
    "code" in value &&
    value.code === "SESSION_EXPIRED"
  );
}

function isReadSessionExpired(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "missing"
  );
}

async function runWithReauthentication<T>(
  operation: () => Promise<T>,
  reauthenticate: (() => Promise<void>) | undefined,
  isSessionExpired: (value: T) => boolean,
): Promise<T> {
  const result = await operation();
  if (!isSessionExpired(result) || !reauthenticate) return result;
  await reauthenticate();
  return operation();
}

export function runAdminAction<T extends AdminActionResult>(
  operation: () => Promise<T>,
  reauthenticate?: () => Promise<void>,
): Promise<T> {
  return runWithReauthentication(
    operation,
    reauthenticate,
    isActionSessionExpired,
  );
}

export function readAdminState<T extends AdminReadState>(
  operation: () => Promise<T>,
  reauthenticate?: () => Promise<void>,
): Promise<T> {
  return runWithReauthentication(
    operation,
    reauthenticate,
    isReadSessionExpired,
  );
}

function kindFromCode(code: string | undefined): AdminClientErrorKind {
  if (code === "SESSION_EXPIRED") return "session";
  if (code === "ADMIN_ACCESS_REQUIRED" || code === "ACTOR_NOT_ACTIVE")
    return "authorization";
  return "generic";
}

function kindFromReadState(
  state: Exclude<AdminReadState, { status: "ready" }>,
): AdminClientErrorKind {
  if (state.status === "missing") return "session";
  if (state.status === "unavailable") return "authorization";
  return kindFromCode(state.code);
}

export function clientErrorFromAction(
  result: Exclude<AdminActionResult, { success: true }>,
): AdminClientError {
  return new AdminClientError(
    result.message,
    result.code,
    kindFromCode(result.code),
  );
}

export function clientErrorFromReadState(
  state: Exclude<AdminReadState, { status: "ready" }>,
): AdminClientError {
  const code = state.status === "missing" ? "SESSION_EXPIRED" : state.code;
  return new AdminClientError(state.message, code, kindFromReadState(state));
}

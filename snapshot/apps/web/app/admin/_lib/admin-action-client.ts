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

type NativeActionFailure = {
  serverError?: { code: string; message: string };
  validationErrors?: unknown;
};
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
    "serverError" in value &&
    typeof value.serverError === "object" &&
    value.serverError !== null &&
    "code" in value.serverError &&
    value.serverError.code === "SESSION_EXPIRED"
  );
}

async function runWithReauthentication<T>(
  operation: () => Promise<T>,
  reauthenticate: (() => Promise<void>) | undefined,
  isSessionExpired: (value: T) => boolean,
  mutationAllowed: boolean | (() => boolean),
): Promise<T> {
  if (
    !(typeof mutationAllowed === "function"
      ? mutationAllowed()
      : mutationAllowed)
  )
    throw new AdminClientError(
      "管理画面の最新データを確認しています。確認が終わるまで操作できません。",
      "SERVER_DATA_REFRESH_PENDING",
      "session",
    );
  const result = await operation();
  if (!isSessionExpired(result) || !reauthenticate) return result;
  await reauthenticate();
  throw new AdminClientError(
    "セッションを再認証しました。この更新操作は実行されていません。最新データを確認し、内容を確認してから手動で再度実行してください。",
    "MUTATION_NOT_PERFORMED_REAUTHENTICATED",
    "session",
  );
}

export function runAdminAction<T>(
  operation: () => Promise<T>,
  reauthenticate?: () => Promise<void>,
  mutationAllowed: boolean | (() => boolean) = true,
): Promise<T> {
  return runWithReauthentication(
    operation,
    reauthenticate,
    isActionSessionExpired,
    mutationAllowed,
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

function clientErrorFromAction(result: {
  serverError: { code: string; message: string };
}): AdminClientError {
  return new AdminClientError(
    result.serverError.message,
    result.serverError.code,
    kindFromCode(result.serverError.code),
  );
}

export function throwForActionFailure(result: NativeActionFailure): void {
  if (result.validationErrors !== undefined)
    throw new AdminClientError("リクエスト形式が正しくありません。");
  if (result.serverError !== undefined)
    throw clientErrorFromAction({ serverError: result.serverError });
}

export function clientErrorFromReadState(
  state: Exclude<AdminReadState, { status: "ready" }>,
): AdminClientError {
  const code = state.status === "missing" ? "SESSION_EXPIRED" : state.code;
  return new AdminClientError(state.message, code, kindFromReadState(state));
}

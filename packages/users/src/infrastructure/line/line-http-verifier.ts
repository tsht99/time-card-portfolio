const verifyIdTokenUrl = "https://api.line.me/oauth2/v2.1/verify";
const verifyAccessTokenUrl = "https://api.line.me/oauth2/v2.1/verify";
const userInfoUrl = "https://api.line.me/oauth2/v2.1/userinfo";
const lineRequestTimeoutMs = 5_000;

type VerifyIdTokenResponse = {
  sub?: unknown;
  name?: unknown;
};

type VerifyAccessTokenResponse = {
  client_id?: unknown;
  expires_in?: unknown;
};

type UserInfoResponse = {
  sub?: unknown;
  name?: unknown;
};

export type LineAuthenticationResult =
  | {
      ok: true;
      lineUserId: string;
      displayName: string | null;
    }
  | {
      ok: false;
      status: 401;
      message: string;
    }
  | {
      ok: false;
      status: 502;
      reason?: LineServiceUnavailableReason;
      message: string;
    };

type LineServiceUnavailableReason =
  | "timeout"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "invalid_response";

const lineAuthenticationFailureMessage = "LINE認証に失敗しました。";
const lineServiceUnavailableMessage = "LINE認証サービスを利用できません。";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVerifyIdTokenResponse(
  value: unknown,
): value is VerifyIdTokenResponse {
  return isObject(value);
}

function isVerifyAccessTokenResponse(
  value: unknown,
): value is VerifyAccessTokenResponse {
  return isObject(value);
}

function isUserInfoResponse(value: unknown): value is UserInfoResponse {
  return isObject(value);
}

function isTimeoutError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (isObject(error) && error.name === "TimeoutError");
}

function classifyRequestError(
  error: unknown,
  signal: AbortSignal,
): LineAuthenticationResult {
  return {
    ok: false,
    status: 502,
    reason: isTimeoutError(error, signal) ? "timeout" : "network_error",
    message: "LINE認証サーバーに接続できません。",
  };
}

function classifyInvalidResponse(
  error: unknown,
  signal: AbortSignal,
): LineAuthenticationResult {
  if (isTimeoutError(error, signal)) {
    return {
      ok: false,
      status: 502,
      reason: "timeout",
      message: "LINE認証サーバーに接続できません。",
    };
  }

  return {
    ok: false,
    status: 502,
    reason: "invalid_response",
    message: "LINE認証レスポンスが正しくありません。",
  };
}

function classifyHttpError(response: Response): LineAuthenticationResult {
  if (response.status >= 500 && response.status <= 599) {
    return {
      ok: false,
      status: 502,
      reason: "upstream_error",
      message: lineServiceUnavailableMessage,
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      status: 502,
      reason: "rate_limited",
      message: lineServiceUnavailableMessage,
    };
  }

  return {
    ok: false,
    status: 401,
    message: lineAuthenticationFailureMessage,
  };
}

export async function verifyIdToken(
  idToken: string,
  channelId: string,
): Promise<LineAuthenticationResult> {
  const params = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
  });

  const signal = AbortSignal.timeout(lineRequestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(verifyIdTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal,
    });
  } catch (error) {
    return classifyRequestError(error, signal);
  }

  if (!response.ok) {
    return classifyHttpError(response);
  }

  let result: unknown;

  try {
    result = await response.json();
  } catch (error) {
    return classifyInvalidResponse(error, signal);
  }

  if (
    !isVerifyIdTokenResponse(result) ||
    typeof result.sub !== "string" ||
    !result.sub
  ) {
    return {
      ok: false,
      status: 401,
      message: lineAuthenticationFailureMessage,
    };
  }

  return {
    ok: true,
    lineUserId: result.sub,
    displayName: typeof result.name === "string" ? result.name : null,
  };
}

export async function verifyAccessToken(
  accessToken: string,
  channelId: string,
): Promise<LineAuthenticationResult> {
  const signal = AbortSignal.timeout(lineRequestTimeoutMs);
  let verifyResponse: Response;

  try {
    const url = new URL(verifyAccessTokenUrl);
    url.searchParams.set("access_token", accessToken);
    verifyResponse = await fetch(url, { signal });
  } catch (error) {
    return classifyRequestError(error, signal);
  }

  if (!verifyResponse.ok) {
    return classifyHttpError(verifyResponse);
  }

  let verifyResult: unknown;

  try {
    verifyResult = await verifyResponse.json();
  } catch (error) {
    return classifyInvalidResponse(error, signal);
  }

  if (
    !isVerifyAccessTokenResponse(verifyResult) ||
    verifyResult.client_id !== channelId ||
    typeof verifyResult.expires_in !== "number" ||
    verifyResult.expires_in <= 0
  ) {
    return {
      ok: false,
      status: 401,
      message: lineAuthenticationFailureMessage,
    };
  }

  const userInfoSignal = AbortSignal.timeout(lineRequestTimeoutMs);
  let userInfoResponse: Response;

  try {
    userInfoResponse = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: userInfoSignal,
    });
  } catch (error) {
    return classifyRequestError(error, userInfoSignal);
  }

  if (!userInfoResponse.ok) {
    return classifyHttpError(userInfoResponse);
  }

  let userInfo: unknown;

  try {
    userInfo = await userInfoResponse.json();
  } catch (error) {
    return classifyInvalidResponse(error, userInfoSignal);
  }

  if (
    !isUserInfoResponse(userInfo) ||
    typeof userInfo.sub !== "string" ||
    !userInfo.sub
  ) {
    return {
      ok: false,
      status: 401,
      message: lineAuthenticationFailureMessage,
    };
  }

  return {
    ok: true,
    lineUserId: userInfo.sub,
    displayName: typeof userInfo.name === "string" ? userInfo.name : null,
  };
}

import type {
  LineIdentityResult,
  LineIdentityVerifier,
} from "../../application/ports/line-identity.ts";
import {
  type LineAuthenticationResult,
  verifyAccessToken,
  verifyIdToken,
} from "./line-http-verifier.ts";

function toIdentityResult(
  result: LineAuthenticationResult,
): LineIdentityResult {
  if (result.ok) return result;
  if (result.status === 401)
    return { ok: false, kind: "invalid", message: result.message };
  return {
    ok: false,
    kind: "unavailable",
    message: result.message,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export function createLineIdentityVerifier(
  channelId: string,
): LineIdentityVerifier {
  return {
    verifyIdToken: async (token) =>
      toIdentityResult(await verifyIdToken(token, channelId)),
    verifyAccessToken: async (token) =>
      toIdentityResult(await verifyAccessToken(token, channelId)),
  };
}

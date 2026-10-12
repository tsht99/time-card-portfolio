export type LineIdentityFailureReason =
  | "timeout"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "invalid_response";

export type LineIdentityResult =
  | { ok: true; lineUserId: string; displayName: string | null }
  | { ok: false; kind: "invalid"; message: string }
  | {
      ok: false;
      kind: "unavailable";
      message: string;
      reason?: LineIdentityFailureReason;
    };

export type LineIdentityVerifier = {
  verifyIdToken(token: string): Promise<LineIdentityResult>;
  verifyAccessToken(token: string): Promise<LineIdentityResult>;
};

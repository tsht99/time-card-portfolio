import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { HttpResponse, http } from "msw";
import { createLineIdentityVerifier } from "./line-identity-verifier.ts";
import { server } from "./test/msw/server.ts";

const verifyUrl = "https://api.line.me/oauth2/v2.1/verify";

before(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
after(() => server.close());

test("LINE HTTP の認証失敗を semantic な Port 結果へ変換する", async () => {
  server.use(
    http.post(verifyUrl, () => HttpResponse.json({}, { status: 401 })),
  );
  assert.deepEqual(
    await createLineIdentityVerifier("channel-id").verifyIdToken("bad-token"),
    { ok: false, kind: "invalid", message: "LINE認証に失敗しました。" },
  );
});

test("LINE HTTP の外部障害と理由を semantic な Port 結果へ変換する", async () => {
  server.use(
    http.post(verifyUrl, () => HttpResponse.json({}, { status: 429 })),
  );
  assert.deepEqual(
    await createLineIdentityVerifier("channel-id").verifyIdToken("token"),
    {
      ok: false,
      kind: "unavailable",
      reason: "rate_limited",
      message: "LINE認証サービスを利用できません。",
    },
  );
});

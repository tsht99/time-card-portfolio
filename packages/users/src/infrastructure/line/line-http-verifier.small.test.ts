import { deepStrictEqual, strictEqual } from "node:assert";
import test, { after, afterEach, before, mock } from "node:test";
import { HttpResponse, http } from "msw";
import { verifyAccessToken, verifyIdToken } from "./line-http-verifier.ts";
import { server } from "./test/msw/server.ts";

const verifyUrl = "https://api.line.me/oauth2/v2.1/verify";
const userInfoUrl = "https://api.line.me/oauth2/v2.1/userinfo";

before(() => {
  server.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  server.resetHandlers();
  mock.restoreAll();
});

after(() => {
  server.close();
});

test("verifyIdToken ignores the picture from the ID token response", async () => {
  server.use(
    http.post(verifyUrl, () =>
      HttpResponse.json({
        sub: "line-user",
        name: "ユーザー",
        picture: "https://example.com/picture.jpg",
      }),
    ),
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: true,
    lineUserId: "line-user",
    displayName: "ユーザー",
  });
});

test("verifyIdToken returns line user data when the picture is absent", async () => {
  server.use(
    http.post(verifyUrl, () => HttpResponse.json({ sub: "line-user" })),
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: true,
    lineUserId: "line-user",
    displayName: null,
  });
});

test("verifyIdToken sends the ID token and channel ID as form data with POST", async () => {
  server.use(
    http.post(verifyUrl, async ({ request }) => {
      strictEqual(
        request.headers.get("content-type"),
        "application/x-www-form-urlencoded",
      );
      const body = new URLSearchParams(await request.text());
      deepStrictEqual(Object.fromEntries(body), {
        id_token: "id-token",
        client_id: "channel-id",
      });

      return HttpResponse.json({ sub: "line-user", name: "ユーザー" });
    }),
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: true,
    lineUserId: "line-user",
    displayName: "ユーザー",
  });
});

test("verifyIdToken returns an authentication error when sub is empty", async () => {
  server.use(http.post(verifyUrl, () => HttpResponse.json({ sub: "" })));

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 401,
    message: "LINE認証に失敗しました。",
  });
});

test("verifyAccessToken ignores the picture from userinfo", async () => {
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ client_id: "channel-id", expires_in: 3600 }),
    ),
    http.get(userInfoUrl, () =>
      HttpResponse.json({
        sub: "line-user",
        name: "ユーザー",
        picture: "https://example.com/picture.jpg",
      }),
    ),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: true,
    lineUserId: "line-user",
    displayName: "ユーザー",
  });
});

test("verifyAccessToken returns line user data when userinfo has no picture", async () => {
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ client_id: "channel-id", expires_in: 3600 }),
    ),
    http.get(userInfoUrl, () => HttpResponse.json({ sub: "line-user" })),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: true,
    lineUserId: "line-user",
    displayName: null,
  });
});

test("verifyAccessToken sends the access token as a query parameter with GET", async () => {
  server.use(
    http.get(verifyUrl, ({ request }) => {
      strictEqual(
        new URL(request.url).searchParams.get("access_token"),
        "access-token",
      );
      return HttpResponse.json({ client_id: "channel-id", expires_in: 3600 });
    }),
    http.get(userInfoUrl, ({ request }) => {
      strictEqual(request.headers.get("authorization"), "Bearer access-token");
      return HttpResponse.json({ sub: "line-user", name: "ユーザー" });
    }),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: true,
    lineUserId: "line-user",
    displayName: "ユーザー",
  });
});

test("verifyAccessToken does not request userinfo after client ID mismatch", async () => {
  let userInfoRequestCount = 0;
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ client_id: "another-channel-id", expires_in: 3600 }),
    ),
    http.get(userInfoUrl, () => {
      userInfoRequestCount += 1;
      return HttpResponse.json({ sub: "line-user" });
    }),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 401,
    message: "LINE認証に失敗しました。",
  });
  strictEqual(userInfoRequestCount, 0);
});

test("verifyAccessToken does not request userinfo when expires_in is zero", async () => {
  let userInfoRequestCount = 0;
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ client_id: "channel-id", expires_in: 0 }),
    ),
    http.get(userInfoUrl, () => {
      userInfoRequestCount += 1;
      return HttpResponse.json({ sub: "line-user" });
    }),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 401,
    message: "LINE認証に失敗しました。",
  });
  strictEqual(userInfoRequestCount, 0);
});

test("verifyAccessToken returns an authentication error when userinfo sub is empty", async () => {
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ client_id: "channel-id", expires_in: 3600 }),
    ),
    http.get(userInfoUrl, () => HttpResponse.json({ sub: "" })),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 401,
    message: "LINE認証に失敗しました。",
  });
});

test("verifyIdToken returns an authentication error for a non-5xx response", async () => {
  server.use(
    http.post(verifyUrl, () => HttpResponse.json({}, { status: 400 })),
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 401,
    message: "LINE認証に失敗しました。",
  });
});

test("verifyIdToken returns a service-unavailable error for a 5xx response", async () => {
  server.use(
    http.post(verifyUrl, () =>
      HttpResponse.json({ access_token: "secret" }, { status: 500 }),
    ),
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "upstream_error",
    message: "LINE認証サービスを利用できません。",
  });
});

test("verifyIdToken returns a rate-limited error for a 429 response", async () => {
  server.use(
    http.post(verifyUrl, () =>
      HttpResponse.json({ error: "rate limited" }, { status: 429 }),
    ),
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "rate_limited",
    message: "LINE認証サービスを利用できません。",
  });
});

test("verifyAccessToken returns an authentication error when token verification has a non-5xx response", async () => {
  server.use(http.get(verifyUrl, () => HttpResponse.json({}, { status: 401 })));

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 401,
    message: "LINE認証に失敗しました。",
  });
});

test("verifyAccessToken returns a service-unavailable error when token verification has a 5xx response", async () => {
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ error: "service secret" }, { status: 503 }),
    ),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "upstream_error",
    message: "LINE認証サービスを利用できません。",
  });
});

test("verifyAccessToken returns an authentication error when userinfo has a non-5xx response", async () => {
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ client_id: "channel-id", expires_in: 3600 }),
    ),
    http.get(userInfoUrl, () => HttpResponse.json({}, { status: 403 })),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 401,
    message: "LINE認証に失敗しました。",
  });
});

test("verifyAccessToken returns a service-unavailable error when userinfo has a 5xx response", async () => {
  server.use(
    http.get(verifyUrl, () =>
      HttpResponse.json({ client_id: "channel-id", expires_in: 3600 }),
    ),
    http.get(userInfoUrl, () =>
      HttpResponse.json({ access_token: "secret" }, { status: 599 }),
    ),
  );

  const result = await verifyAccessToken("access-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "upstream_error",
    message: "LINE認証サービスを利用できません。",
  });
});

test("verifyIdToken returns a bad-response error for invalid JSON", async () => {
  server.use(
    http.post(verifyUrl, () => new HttpResponse("{invalid", { status: 200 })),
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "invalid_response",
    message: "LINE認証レスポンスが正しくありません。",
  });
});

test("sets a five-second timeout signal on all LINE requests", async () => {
  const timeoutValues: number[] = [];

  mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    timeoutValues.push(milliseconds);
    return new AbortController().signal;
  });

  server.use(
    http.post(verifyUrl, ({ request }) => {
      strictEqual(request.signal instanceof AbortSignal, true);
      return HttpResponse.json({ sub: "line-user" });
    }),
    http.get(verifyUrl, ({ request }) => {
      strictEqual(request.signal instanceof AbortSignal, true);
      return HttpResponse.json({ client_id: "channel-id", expires_in: 3600 });
    }),
    http.get(userInfoUrl, ({ request }) => {
      strictEqual(request.signal instanceof AbortSignal, true);
      return HttpResponse.json({ sub: "line-user" });
    }),
  );

  const idTokenResult = await verifyIdToken("id-token", "channel-id");
  const accessTokenResult = await verifyAccessToken(
    "access-token",
    "channel-id",
  );

  strictEqual(idTokenResult.ok, true);
  strictEqual(accessTokenResult.ok, true);
  deepStrictEqual(timeoutValues, [5000, 5000, 5000]);
});

test("classifies a fetch timeout as a service-unavailable error", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;

  mock.method(AbortSignal, "timeout", () => controller.signal);
  mock.method(
    globalThis,
    "fetch",
    async (...args: Parameters<typeof fetch>) => {
      requestSignal = args[1]?.signal ?? undefined;
      throw new DOMException("The operation timed out", "TimeoutError");
    },
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "timeout",
    message: "LINE認証サーバーに接続できません。",
  });
  strictEqual(requestSignal, controller.signal);
});

test("classifies a non-timeout fetch rejection as a network error", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network failure");
  });

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "network_error",
    message: "LINE認証サーバーに接続できません。",
  });
});

test("classifies a timeout while reading response JSON as a timeout", async () => {
  const controller = new AbortController();

  mock.method(AbortSignal, "timeout", () => controller.signal);
  mock.method(
    globalThis,
    "fetch",
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          controller.abort();
          throw new DOMException("The operation was aborted", "AbortError");
        },
      }) as unknown as Response,
  );

  const result = await verifyIdToken("id-token", "channel-id");

  deepStrictEqual(result, {
    ok: false,
    status: 502,
    reason: "timeout",
    message: "LINE認証サーバーに接続できません。",
  });
});

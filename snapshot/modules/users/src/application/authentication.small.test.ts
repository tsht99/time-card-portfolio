import assert from "node:assert/strict";
import test from "node:test";

import type { UserAccessState } from "../domain/user.ts";
import {
  authorizeActiveAdmin,
  createAuthenticationApplication,
} from "./authentication.ts";
import type { LineIdentityResult } from "./ports/line-identity.ts";
import type {
  SessionReader,
  UserRegistration,
  UsersUnitOfWork,
} from "./ports/user-persistence.ts";

const credential = "a".repeat(43);
const expiresAt = new Date("2026-02-01T00:00:00.000Z");
const activeStaff: UserAccessState = {
  userId: "user-1",
  role: "staff",
  status: "active",
  displayName: "業務名",
};

function makePorts(
  options: {
    idResult?: LineIdentityResult;
    accessResult?: LineIdentityResult;
    lockedUser?: UserAccessState;
    storedSession?: Awaited<
      ReturnType<SessionReader["findSessionByCredential"]>
    >;
  } = {},
) {
  const calls: string[] = [];
  let initialName: string | null | undefined;
  const identity = options.idResult ?? {
    ok: true as const,
    lineUserId: "line-1",
    displayName: "  LINE 名  ",
  };
  const line = {
    async verifyIdToken() {
      calls.push("verify-id");
      return identity;
    },
    async verifyAccessToken() {
      calls.push("verify-access");
      return options.accessResult ?? identity;
    },
  };
  const users: UserRegistration = {
    async findOrCreateByLineIdentity(input) {
      calls.push("register");
      assert.equal(input.initialRole, "staff");
      assert.equal(input.initialStatus, "pending");
      initialName = input.displayName;
      return { userId: activeStaff.userId };
    },
  };
  const sessions: SessionReader = {
    async findSessionByCredential(value) {
      calls.push(`read-session:${value}`);
      assert.equal(value, credential);
      return options.storedSession ?? null;
    },
  };
  const unitOfWork: UsersUnitOfWork = {
    async run(operation) {
      calls.push("begin");
      const value = await operation({
        async readUser(userId) {
          calls.push(`read:${userId}`);
          return options.lockedUser ?? activeStaff;
        },
        async lockUser(userId) {
          calls.push(`lock:${userId}`);
          return options.lockedUser ?? activeStaff;
        },
        async listUsers() {
          return [activeStaff];
        },
        async issueSession(userId) {
          calls.push(`issue:${userId}`);
          return { credential, expiresAt };
        },
        async setAccessStatus() {
          throw new Error("unused");
        },
        async setDisplayName() {
          throw new Error("unused");
        },
        async revokeSessions() {
          throw new Error("unused");
        },
      });
      calls.push("commit");
      return { ok: true, value };
    },
  };
  return {
    calls,
    getInitialName: () => initialName,
    line,
    users,
    sessions,
    unitOfWork,
  };
}

test("ID token 優先、失敗時 fallback、初回 LINE 表示名はtrimして渡す", async () => {
  const ports = makePorts({
    idResult: { ok: false, kind: "invalid", message: "bad id" },
    accessResult: {
      ok: true,
      lineUserId: "line-1",
      displayName: "  LINE 名  ",
    },
  });
  const result = await createAuthenticationApplication(
    ports,
  ).authenticateWithLine({
    idToken: "id",
    accessToken: "access",
  });
  assert.deepEqual(result, { ok: true, credential, expiresAt });
  assert.equal(ports.getInitialName(), "LINE 名");
  assert.deepEqual(ports.calls, [
    "verify-id",
    "verify-access",
    "register",
    "begin",
    "lock:user-1",
    "issue:user-1",
    "commit",
  ]);

  const idPreferred = makePorts();
  await createAuthenticationApplication(idPreferred).authenticateWithLine({
    idToken: "id",
    accessToken: "access",
  });
  assert.equal(idPreferred.calls.includes("verify-access"), false);
});

test("LINE 表示名が空白のみ、または101コードポイントならnullでpending登録する", async () => {
  for (const displayName of ["   ", "😀".repeat(101)]) {
    const ports = makePorts({
      idResult: { ok: true, lineUserId: "line-1", displayName },
      lockedUser: { ...activeStaff, status: "pending", displayName: null },
    });
    const result = await createAuthenticationApplication(
      ports,
    ).authenticateWithLine({
      idToken: "id",
    });
    assert.deepEqual(result, {
      ok: false,
      code: "USER_PENDING",
      message: "管理者の承認待ちです。",
    });
    assert.equal(ports.getInitialName(), null);
  }
});

test("本人確認の失敗とサービス障害の優先順位を維持する", async () => {
  const cases = [
    {
      id: { ok: false, kind: "invalid", message: "bad id" },
      access: { ok: false, kind: "invalid", message: "bad access" },
      expected: { ok: false, code: "LINE_AUTH_FAILED", message: "bad access" },
    },
    {
      id: {
        ok: false,
        kind: "unavailable",
        message: "id down",
        reason: "timeout",
      },
      access: { ok: false, kind: "invalid", message: "bad access" },
      expected: {
        ok: false,
        code: "LINE_SERVICE_UNAVAILABLE",
        message: "id down",
        reason: "timeout",
      },
    },
    {
      id: { ok: false, kind: "invalid", message: "bad id" },
      access: {
        ok: false,
        kind: "unavailable",
        message: "access down",
        reason: "rate_limited",
      },
      expected: {
        ok: false,
        code: "LINE_SERVICE_UNAVAILABLE",
        message: "access down",
        reason: "rate_limited",
      },
    },
    {
      id: { ok: false, kind: "unavailable", message: "id down" },
      access: { ok: false, kind: "unavailable", message: "access down" },
      expected: {
        ok: false,
        code: "LINE_SERVICE_UNAVAILABLE",
        message: "access down",
      },
    },
  ] as const;
  for (const { id, access, expected } of cases) {
    const ports = makePorts({ idResult: id, accessResult: access });
    assert.deepEqual(
      await createAuthenticationApplication(ports).authenticateWithLine({
        idToken: "id",
        accessToken: "access",
      }),
      expected,
    );
    assert.equal(ports.calls.includes("register"), false);
  }
});

test("LINE の invalid_response 理由をサービス障害結果へ伝える", async () => {
  const ports = makePorts({
    idResult: {
      ok: false,
      kind: "unavailable",
      reason: "invalid_response",
      message: "LINE認証レスポンスが正しくありません。",
    },
  });

  assert.deepEqual(
    await createAuthenticationApplication(ports).authenticateWithLine({
      idToken: "id",
    }),
    {
      ok: false,
      code: "LINE_SERVICE_UNAVAILABLE",
      reason: "invalid_response",
      message: "LINE認証レスポンスが正しくありません。",
    },
  );
});

test("認証情報なし、最新 status が pending/inactive の場合は session を発行しない", async () => {
  const noCredentials = makePorts();
  assert.deepEqual(
    await createAuthenticationApplication(noCredentials).authenticateWithLine(
      {},
    ),
    {
      ok: false,
      code: "LINE_AUTH_REQUIRED",
      message: "LINE認証情報がありません。",
    },
  );
  assert.deepEqual(noCredentials.calls, []);

  for (const [status, code, message] of [
    ["pending", "USER_PENDING", "管理者の承認待ちです。"],
    ["inactive", "USER_INACTIVE", "このユーザーは利用停止中です。"],
  ] as const) {
    const ports = makePorts({ lockedUser: { ...activeStaff, status } });
    assert.deepEqual(
      await createAuthenticationApplication(ports).authenticateWithLine({
        idToken: "id",
      }),
      { ok: false, code, message },
    );
    assert.equal(
      ports.calls.some((call) => call.startsWith("issue:")),
      false,
    );
    assert.deepEqual(ports.calls.slice(-2), ["lock:user-1", "commit"]);
  }
});

test("admin LINE 認証は lock 後に role を確認し、active admin だけ session を発行する", async () => {
  const staff = makePorts({ lockedUser: activeStaff });
  assert.deepEqual(
    await createAuthenticationApplication(staff).authenticateAdminWithLine({
      idToken: "id",
    }),
    {
      ok: false,
      code: "ADMIN_ACCESS_REQUIRED",
      message: "このアカウントには管理権限がありません。",
    },
  );
  assert.equal(staff.calls.includes("issue:user-1"), false);
  assert.deepEqual(staff.calls.slice(-2), ["lock:user-1", "commit"]);

  const admin = makePorts({
    lockedUser: { ...activeStaff, role: "admin" },
  });
  assert.deepEqual(
    await createAuthenticationApplication(admin).authenticateAdminWithLine({
      idToken: "id",
    }),
    { ok: true, credential, expiresAt },
  );
  assert.deepEqual(admin.calls.slice(-3), [
    "lock:user-1",
    "issue:user-1",
    "commit",
  ]);
});

test("admin LINE 認証でも最新 pending/inactive の既存結果を維持する", async () => {
  for (const [status, code, message] of [
    ["pending", "USER_PENDING", "管理者の承認待ちです。"],
    ["inactive", "USER_INACTIVE", "このユーザーは利用停止中です。"],
  ] as const) {
    const ports = makePorts({ lockedUser: { ...activeStaff, status } });
    assert.deepEqual(
      await createAuthenticationApplication(ports).authenticateAdminWithLine({
        idToken: "id",
      }),
      { ok: false, code, message },
    );
    assert.equal(
      ports.calls.some((call) => call.startsWith("issue:")),
      false,
    );
  }
});

test("credential digest lookup、失効、期限、最新 user status を検査する", async () => {
  const base = { user: activeStaff, expiresAt, revokedAt: null };
  const cases = [
    { record: base, ok: true },
    { record: { ...base, revokedAt: new Date("2026-01-01") }, ok: false },
    { record: { ...base, expiresAt: new Date("2026-01-01") }, ok: false },
    {
      record: {
        ...base,
        user: { ...activeStaff, status: "inactive" as const },
      },
      ok: false,
    },
  ];
  for (const { record, ok } of cases) {
    const ports = makePorts({ storedSession: record });
    const result = await createAuthenticationApplication({
      ...ports,
      now: () => new Date("2026-01-15"),
    }).resolveActiveSession(credential);
    assert.equal(result.ok, ok);
  }
  const ports = makePorts();
  const app = createAuthenticationApplication(ports);
  for (const invalid of [
    "bad-id",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "a".repeat(64),
  ])
    assert.deepEqual(await app.resolveActiveSession(invalid), {
      ok: false,
      code: "SESSION_EXPIRED",
    });
  assert.deepEqual(ports.calls, []);
});

test("管理者 session の権限判定を Authentication Application で行う", async () => {
  const ports = makePorts({
    storedSession: { user: activeStaff, expiresAt, revokedAt: null },
  });
  const result = await createAuthenticationApplication({
    ...ports,
    now: () => new Date("2026-01-15"),
  }).resolveActiveAdminSession(credential);
  assert.deepEqual(result, { ok: false, code: "ADMIN_ACCESS_REQUIRED" });
});

test("active admin の認可を区別する", () => {
  assert.deepEqual(authorizeActiveAdmin(activeStaff), {
    ok: false,
    code: "ADMIN_ACCESS_REQUIRED",
  });
  assert.deepEqual(authorizeActiveAdmin({ ...activeStaff, role: "admin" }), {
    ok: true,
    user: { ...activeStaff, role: "admin" },
  });
});

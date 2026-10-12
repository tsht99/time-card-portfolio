import { describe, expect, test } from "vitest";
import type { AuthBootstrapState } from "../../lib/auth-types";
import { getAdminAuthScopeKey } from "./template.tsx";

const ready = {
  status: "ready",
  user: {
    userId: "admin-1",
    displayName: "管理者",
    role: "admin",
    status: "active",
  },
} satisfies AuthBootstrapState;

describe("admin template auth scope key", () => {
  test("ready is keyed only by user ID", () => {
    expect(getAdminAuthScopeKey(ready)).toBe("ready:admin-1");
    expect(
      getAdminAuthScopeKey({
        ...ready,
        user: { ...ready.user, displayName: "更新後の名前" },
      }),
    ).toBe("ready:admin-1");
  });

  test("unavailable and error include their required identity details", () => {
    expect(
      getAdminAuthScopeKey({
        status: "unavailable",
        code: "ADMIN_ACCESS_REQUIRED",
        message: "権限なし",
      }),
    ).toBe("unavailable:ADMIN_ACCESS_REQUIRED:権限なし");
    expect(getAdminAuthScopeKey({ status: "error", message: "認証失敗" })).toBe(
      "error:認証失敗",
    );
  });

  test("missing keeps its existing key", () => {
    expect(
      getAdminAuthScopeKey({
        status: "missing",
        message: "ログインが必要です。",
      }),
    ).toBe("missing");
  });
});

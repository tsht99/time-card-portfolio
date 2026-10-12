import { describe, expect, test } from "vitest";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { getStaffAuthScopeKey } from "./staff-auth-scope.ts";

const readyA: AuthBootstrapState = {
  status: "ready",
  user: {
    userId: "staff-a",
    displayName: "A",
    role: "staff",
    status: "active",
  },
};

describe("getStaffAuthScopeKey", () => {
  test("same-user refresh keeps the scope stable and another user gets a new scope", () => {
    expect(getStaffAuthScopeKey(readyA)).toBe(getStaffAuthScopeKey(readyA));
    expect(
      getStaffAuthScopeKey({
        ...readyA,
        user: { ...readyA.user, userId: "staff-b" },
      }),
    ).not.toBe(getStaffAuthScopeKey(readyA));
  });

  test("missing, unavailable, and error each have a non-ready scope", () => {
    const keys = [
      getStaffAuthScopeKey({ status: "missing", message: "login" }),
      getStaffAuthScopeKey({
        status: "unavailable",
        code: "ACTOR_NOT_ACTIVE",
        message: "inactive",
      }),
      getStaffAuthScopeKey({ status: "error", message: "error" }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(getStaffAuthScopeKey(readyA));
  });
});

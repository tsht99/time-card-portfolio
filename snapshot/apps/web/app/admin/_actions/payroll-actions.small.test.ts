import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

async function callAction(action: unknown, input: unknown) {
  if (typeof action !== "function")
    throw new TypeError("Expected action function");
  return action(input);
}

const mocks = vi.hoisted(() => ({
  updateUserAccessStatus: vi.fn(),
  updateUserDisplayName: vi.fn(),
  updateHourlyWageRule: vi.fn(),
  deleteHourlyWageRule: vi.fn(),
  bulkUpdateHourlyWageRules: vi.fn(),
  createUserApplication: vi.fn(),
  createHourlyApplication: vi.fn(),
  resolve: vi.fn(),
  revalidatePath: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("../../../lib/server/payroll-composition", () => ({
  createHourlyWageRuleManagementApplication: mocks.createHourlyApplication,
}));
vi.mock("../../../lib/server/users-composition", () => ({
  createTimeCardUserManagementApplication: mocks.createUserApplication,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../lib/server/auth-session", () => ({
  resolveAuthenticatedUserSession: mocks.resolve,
}));
vi.mock("../../../lib/server/server-observability", () => ({
  reportUnexpectedServerException: mocks.report,
}));

const admin = {
  status: "ready",
  user: {
    userId: "admin-1",
    displayName: "管理者",
    role: "admin",
    status: "active",
  },
};
const request = {
  workPeriod: "day",
  dayType: "mon",
  hourlyWage: 1200,
  effectiveFrom: "2026-08-01",
} as const;
const versionedRequest = { ...request, expectedVersion: 1 } as const;
const hourlyWageRuleId = "11111111-1111-4111-8111-111111111111";

afterEach(() =>
  Object.values(mocks).forEach((mock) => {
    mock.mockReset();
  }),
);

function application() {
  mocks.createUserApplication.mockReturnValue({
    updateUserAccessStatus: mocks.updateUserAccessStatus,
    updateUserDisplayName: mocks.updateUserDisplayName,
  });
  mocks.createHourlyApplication.mockReturnValue({
    updateHourlyWageRule: mocks.updateHourlyWageRule,
    deleteHourlyWageRule: mocks.deleteHourlyWageRule,
    bulkUpdateHourlyWageRules: mocks.bulkUpdateHourlyWageRules,
  });
}

describe("admin payroll actions", () => {
  test("userId は update / bulk update / delete の認証・application 前に UUID 検証する", async () => {
    const {
      bulkUpdateAdminHourlyWageRulesAction,
      deleteAdminHourlyWageRuleAction,
      updateAdminHourlyWageRuleAction,
    } = await import("./payroll-actions.ts");
    const inputs = [
      [
        updateAdminHourlyWageRuleAction,
        {
          userId: "staff-1",
          hourlyWageRuleId,
          ...versionedRequest,
        },
      ],
      [
        bulkUpdateAdminHourlyWageRulesAction,
        {
          userId: "staff-1",
          effectiveFrom: "2026-10-01",
          changes: [
            {
              dayType: "mon",
              workPeriod: "day",
              hourlyWage: 1200,
              expectedBaseline: null,
            },
          ],
        },
      ],
      [
        deleteAdminHourlyWageRuleAction,
        {
          userId: "staff-1",
          hourlyWageRuleId,
          expectedVersion: 1,
        },
      ],
    ] as const;
    for (const [action, input] of inputs) {
      await expect(callAction(action, input)).resolves.toEqual({
        validationErrors: expect.anything(),
      });
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
    expect(mocks.updateHourlyWageRule).not.toHaveBeenCalled();
    expect(mocks.bulkUpdateHourlyWageRules).not.toHaveBeenCalled();
    expect(mocks.deleteHourlyWageRule).not.toHaveBeenCalled();
  });
  test("expectedVersion は必須の正整数として認証・applicationの前に検証する", async () => {
    const { deleteAdminHourlyWageRuleAction, updateAdminHourlyWageRuleAction } =
      await import("./payroll-actions.ts");
    const invalidVersions = [undefined, 0, -1, 1.5];
    for (const expectedVersion of invalidVersions) {
      await expect(
        callAction(updateAdminHourlyWageRuleAction, {
          userId: "550e8400-e29b-41d4-a716-446655440000",
          hourlyWageRuleId,
          ...request,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        }),
      ).resolves.toEqual({ validationErrors: expect.anything() });
      await expect(
        callAction(deleteAdminHourlyWageRuleAction, {
          userId: "550e8400-e29b-41d4-a716-446655440000",
          hourlyWageRuleId,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        }),
      ).resolves.toEqual({ validationErrors: expect.anything() });
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
  });
  test("時給の範囲外値を認証・applicationの前に拒否する", async () => {
    const { updateAdminHourlyWageRuleAction } = await import(
      "./payroll-actions.ts"
    );
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        ...versionedRequest,
        hourlyWage: 100_000,
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();

    mocks.resolve.mockResolvedValueOnce(admin);
    application();
  });
  test("individual update/delete は exact input、uuid validation、business mapping、再検証を行う", async () => {
    const { deleteAdminHourlyWageRuleAction, updateAdminHourlyWageRuleAction } =
      await import("./payroll-actions.ts");
    await callAction(updateAdminHourlyWageRuleAction, {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      hourlyWageRuleId: "not-uuid",
      ...versionedRequest,
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateHourlyWageRule.mockResolvedValueOnce({
      kind: "user-not-found",
    });
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        ...versionedRequest,
      }),
    ).resolves.toMatchObject({ serverError: { code: "USER_NOT_FOUND" } });
    mocks.updateHourlyWageRule.mockResolvedValueOnce({
      kind: "rule-not-found",
    });
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        ...versionedRequest,
      }),
    ).resolves.toMatchObject({
      serverError: { code: "HOURLY_WAGE_RULE_NOT_FOUND" },
    });
    mocks.updateHourlyWageRule.mockResolvedValueOnce({
      kind: "already-exists",
    });
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        ...versionedRequest,
      }),
    ).resolves.toMatchObject({
      serverError: { code: "HOURLY_WAGE_RULE_ALREADY_EXISTS" },
    });
    mocks.deleteHourlyWageRule.mockResolvedValueOnce({
      kind: "user-not-found",
    });
    await expect(
      callAction(deleteAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ serverError: { code: "USER_NOT_FOUND" } });
    mocks.deleteHourlyWageRule.mockResolvedValueOnce({
      kind: "rule-not-found",
    });
    await expect(
      callAction(deleteAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({
      serverError: { code: "HOURLY_WAGE_RULE_NOT_FOUND" },
    });
    mocks.updateHourlyWageRule.mockResolvedValueOnce({
      kind: "version-conflict",
    });
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        ...versionedRequest,
      }),
    ).resolves.toEqual({
      serverError: {
        code: "HOURLY_WAGE_RULE_VERSION_CONFLICT",
        message:
          "対象の時給ルールは他の操作により変更されています。最新の内容を確認してから再操作してください。",
      },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.deleteHourlyWageRule.mockResolvedValueOnce({
      kind: "version-conflict",
    });
    await expect(
      callAction(deleteAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual({
      serverError: {
        code: "HOURLY_WAGE_RULE_VERSION_CONFLICT",
        message:
          "対象の時給ルールは他の操作により変更されています。最新の内容を確認してから再操作してください。",
      },
    });
    mocks.updateHourlyWageRule.mockResolvedValueOnce({
      kind: "success",
      hourlyWageRule: { id: hourlyWageRuleId },
    });
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        ...versionedRequest,
      }),
    ).resolves.toEqual({ data: undefined });
    expect(mocks.updateHourlyWageRule).toHaveBeenLastCalledWith({
      userId: "550e8400-e29b-41d4-a716-446655440000",
      hourlyWageRuleId,
      ...versionedRequest,
      actorUserId: "admin-1",
    });
    mocks.deleteHourlyWageRule.mockResolvedValueOnce({
      kind: "success",
      hourlyWageRuleId,
    });
    await expect(
      callAction(deleteAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual({ data: undefined });
    expect(mocks.deleteHourlyWageRule).toHaveBeenLastCalledWith({
      userId: "550e8400-e29b-41d4-a716-446655440000",
      hourlyWageRuleId,
      expectedVersion: 1,
      actorUserId: "admin-1",
    });
    expect(mocks.createHourlyApplication).toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440000/hourly-wage-rules",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440000/hourly-wage-rules/history",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440000/payroll-estimates",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/payroll-estimates",
    );
  });
  test("role-forbidden は固定結果を返し、再検証・例外報告を行わない", async () => {
    const { deleteAdminHourlyWageRuleAction, updateAdminHourlyWageRuleAction } =
      await import("./payroll-actions.ts");
    mocks.resolve.mockResolvedValue(admin);
    application();
    const forbidden = {
      serverError: {
        code: "HOURLY_WAGE_RULE_UPDATE_FORBIDDEN",
        message: "他の管理者の時給ルールは変更できません。",
      },
    };
    mocks.updateHourlyWageRule.mockResolvedValueOnce({
      kind: "role-forbidden",
    });
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440001",
        hourlyWageRuleId,
        ...versionedRequest,
      }),
    ).resolves.toEqual(forbidden);
    mocks.deleteHourlyWageRule.mockResolvedValueOnce({
      kind: "role-forbidden",
    });
    await expect(
      callAction(deleteAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440001",
        hourlyWageRuleId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual(forbidden);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
  test("individual update/delete の unexpected は固定 operation で report する", async () => {
    const { deleteAdminHourlyWageRuleAction, updateAdminHourlyWageRuleAction } =
      await import("./payroll-actions.ts");
    mocks.resolve.mockResolvedValue(admin);
    application();
    const updateError = new Error("update");
    const deleteError = new Error("delete");
    mocks.updateHourlyWageRule.mockRejectedValueOnce(updateError);
    mocks.deleteHourlyWageRule.mockRejectedValueOnce(deleteError);
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        ...versionedRequest,
      }),
    ).resolves.toEqual({
      serverError: {
        code: "INTERNAL_SERVER_ERROR",
        message: "時給ルールを更新できませんでした。",
      },
    });
    await expect(
      callAction(deleteAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        hourlyWageRuleId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual({
      serverError: {
        code: "INTERNAL_SERVER_ERROR",
        message: "時給ルールを削除できませんでした。",
      },
    });
    expect(mocks.report).toHaveBeenCalledWith(
      updateError,
      "admin.hourly-wage.action.update",
    );
    expect(mocks.report).toHaveBeenCalledWith(
      deleteError,
      "admin.hourly-wage.action.delete",
    );
  });
});

describe("bulk hourly wage Server Action infrastructure failures", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createHourlyApplication.mockReturnValue({
      bulkUpdateHourlyWageRules: mocks.bulkUpdateHourlyWageRules,
    });
    mocks.resolve.mockResolvedValue({
      status: "ready",
      user: { userId: "admin-1", role: "admin" },
    });
  });

  test("returns a safe error and reports the original database exception", async () => {
    const error = Object.assign(
      new Error("raw PostgreSQL connection details"),
      { code: "40001" },
    );
    mocks.bulkUpdateHourlyWageRules.mockRejectedValue(error);
    const { bulkUpdateAdminHourlyWageRulesAction } = await import(
      "./payroll-actions.ts"
    );

    const result = await callAction(bulkUpdateAdminHourlyWageRulesAction, {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      effectiveFrom: "2026-10-01",
      changes: [
        {
          dayType: "mon",
          workPeriod: "day",
          hourlyWage: 1200,
          expectedBaseline: null,
        },
      ],
    });

    expect(result).toEqual({
      serverError: {
        code: "INTERNAL_SERVER_ERROR",
        message: "時給を更新できませんでした。",
      },
    });
    expect(JSON.stringify(result)).not.toContain("raw PostgreSQL");
    expect(mocks.report).toHaveBeenCalledWith(
      error,
      "admin.hourly-wage.action.bulk-update",
    );
  });
});

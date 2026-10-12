import { afterEach, describe, expect, test, vi } from "vitest";

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
    userId: "550e8400-e29b-41d4-a716-446655440001",
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
  });
}

describe("admin user-management actions", () => {
  test("strict validation rejects malformed and forged input before auth/application", async () => {
    const {
      updateAdminUserAccessStatusAction,
      updateAdminUserDisplayNameAction,
    } = await import("./user-management-actions.ts");
    const { deleteAdminHourlyWageRuleAction, updateAdminHourlyWageRuleAction } =
      await import("./payroll-actions.ts");
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "active",
        role: "admin",
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        displayName: "スタッフ",
        actorUserId: "550e8400-e29b-41d4-a716-446655440001",
        role: "admin",
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    await expect(
      callAction(updateAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        hourlyWageRuleId,
        ...request,
        role: "admin",
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    await expect(
      callAction(deleteAdminHourlyWageRuleAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        hourlyWageRuleId,
        actor: admin.user,
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
  });
  test("未認証と resolver failure を区別し、権限判定は Application に委譲する", async () => {
    const { updateAdminUserAccessStatusAction } = await import(
      "./user-management-actions.ts"
    );
    mocks.resolve.mockResolvedValueOnce({
      status: "missing",
      message: "ログインが必要です。",
    });
    const missing = await callAction(updateAdminUserAccessStatusAction, {
      userId: "550e8400-e29b-41d4-a716-446655440002",
      status: "active",
    });
    expect(missing).toEqual({
      serverError: {
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
    });
    mocks.resolve.mockResolvedValueOnce(admin);
    application();
    mocks.updateUserAccessStatus.mockResolvedValueOnce({
      kind: "actor-forbidden",
      code: "ADMIN_ACCESS_REQUIRED",
    });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "active",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "ADMIN_ACCESS_REQUIRED",
        message: "この操作を行う権限がありません。",
      },
    });
    mocks.resolve.mockResolvedValueOnce({
      status: "error",
      message: "認証エラー",
    });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "active",
      }),
    ).resolves.toEqual({
      serverError: { code: "ACTION_FAILED", message: "認証エラー" },
    });
    expect(mocks.updateUserAccessStatus).toHaveBeenCalledTimes(1);
    expect(missing).not.toHaveProperty("sessionId");
    expect(missing).not.toHaveProperty("actor");
  });
  test("status は exact input、business mapping、成功時の全path再検証を行う", async () => {
    const { updateAdminUserAccessStatusAction } = await import(
      "./user-management-actions.ts"
    );
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserAccessStatus.mockResolvedValueOnce({ kind: "not-found" });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "inactive",
      }),
    ).resolves.toMatchObject({ serverError: { code: "USER_NOT_FOUND" } });
    mocks.updateUserAccessStatus.mockResolvedValueOnce({
      kind: "role-forbidden",
    });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "inactive",
      }),
    ).resolves.toMatchObject({
      serverError: { code: "ADMIN_ACCESS_STATUS_UPDATE_FORBIDDEN" },
    });
    mocks.updateUserAccessStatus.mockResolvedValueOnce({
      kind: "transition-forbidden",
    });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "inactive",
      }),
    ).resolves.toMatchObject({
      serverError: { code: "USER_ACCESS_STATUS_TRANSITION_FORBIDDEN" },
    });
    mocks.updateUserAccessStatus.mockResolvedValueOnce({
      kind: "display-name-required",
    });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "active",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "USER_DISPLAY_NAME_REQUIRED",
        message:
          "対象スタッフの表示名を設定してから、承認・有効化してください。",
      },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.updateUserAccessStatus.mockResolvedValueOnce({
      kind: "display-name-conflict",
    });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "active",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "USER_DISPLAY_NAME_CONFLICT",
        message:
          "同じ表示名の利用中または停止中スタッフがいるため、有効にできません。対象スタッフの表示名を変更してから再試行してください。",
      },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.updateUserAccessStatus.mockResolvedValueOnce({
      kind: "success",
      userId: "550e8400-e29b-41d4-a716-446655440002",
      status: "inactive",
    });
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "inactive",
      }),
    ).resolves.toEqual({ data: undefined });
    expect(mocks.updateUserAccessStatus).toHaveBeenLastCalledWith({
      actorUserId: "550e8400-e29b-41d4-a716-446655440001",
      userId: "550e8400-e29b-41d4-a716-446655440002",
      status: "inactive",
    });
    expect(mocks.createUserApplication).toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440002",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/payroll-estimates",
    );
  });
  test("status の unexpected は固定 operation で report する", async () => {
    const { updateAdminUserAccessStatusAction } = await import(
      "./user-management-actions.ts"
    );
    const error = new Error("db");
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserAccessStatus.mockRejectedValue(error);
    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        status: "inactive",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "INTERNAL_SERVER_ERROR",
        message: "ユーザーの利用状態を更新できませんでした。",
      },
    });
    expect(mocks.report).toHaveBeenCalledWith(
      error,
      "admin.users.action.update-access-status",
    );
  });
  test("displayName 更新は strict validation、trim、business mapping、成功時の全path再検証を行う", async () => {
    const { updateAdminUserDisplayNameAction } = await import(
      "./user-management-actions.ts"
    );
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        displayName: "山田",
        role: "staff",
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        displayName: "   ",
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    expect(mocks.resolve).not.toHaveBeenCalled();

    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "display-name-too-long",
    });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        displayName: "😀".repeat(101),
      }),
    ).resolves.toEqual({
      serverError: {
        code: "USER_DISPLAY_NAME_TOO_LONG",
        message: "表示名は100文字以内で入力してください。",
      },
    });
    for (const [kind, code] of [
      ["not-found", "USER_NOT_FOUND"],
      ["role-forbidden", "ADMIN_DISPLAY_NAME_UPDATE_FORBIDDEN"],
      ["display-name-conflict", "USER_DISPLAY_NAME_CONFLICT"],
    ] as const) {
      mocks.updateUserDisplayName.mockResolvedValueOnce({ kind });
      await expect(
        callAction(updateAdminUserDisplayNameAction, {
          userId: "550e8400-e29b-41d4-a716-446655440002",
          displayName: "  山田 太郎  ",
        }),
      ).resolves.toMatchObject({ serverError: { code } });
    }
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "role-forbidden",
    });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440003",
        displayName: "別管理者",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "ADMIN_DISPLAY_NAME_UPDATE_FORBIDDEN",
        message: "他の管理者の表示名は変更できません。",
      },
    });
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "display-name-conflict",
    });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        displayName: "  山田 太郎  ",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "USER_DISPLAY_NAME_CONFLICT",
        message:
          "同じ表示名の利用中または停止中の利用者がいるため、表示名を変更できません。別の表示名を入力してください。",
      },
    });
    expect(mocks.updateUserDisplayName).toHaveBeenCalledWith({
      userId: "550e8400-e29b-41d4-a716-446655440002",
      displayName: "山田 太郎",
      actorUserId: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(mocks.createUserApplication).toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "success",
      userId: "550e8400-e29b-41d4-a716-446655440002",
      displayName: "山田 太郎",
    });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        displayName: "  山田 太郎  ",
      }),
    ).resolves.toEqual({ data: undefined });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440002",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440002/hourly-wage-rules",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440002/hourly-wage-rules/history",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/550e8400-e29b-41d4-a716-446655440002/payroll-estimates",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/payroll-estimates",
    );
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "success",
      userId: "550e8400-e29b-41d4-a716-446655440001",
      displayName: "管理者本人",
    });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440001",
        displayName: "管理者本人",
      }),
    ).resolves.toEqual({ data: undefined });
    expect(mocks.updateUserDisplayName).toHaveBeenLastCalledWith({
      userId: "550e8400-e29b-41d4-a716-446655440001",
      displayName: "管理者本人",
      actorUserId: "550e8400-e29b-41d4-a716-446655440001",
    });
  });
  test("両 action は不正な userId を session 解決前に拒否する", async () => {
    const {
      updateAdminUserAccessStatusAction,
      updateAdminUserDisplayNameAction,
    } = await import("./user-management-actions.ts");

    await expect(
      callAction(updateAdminUserAccessStatusAction, {
        userId: "not-a-uuid",
        status: "active",
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "not-a-uuid",
        displayName: "対象スタッフ",
      }),
    ).resolves.toEqual({ validationErrors: expect.anything() });

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(mocks.updateUserAccessStatus).not.toHaveBeenCalled();
    expect(mocks.updateUserDisplayName).not.toHaveBeenCalled();
  });
  test("displayName 更新の unexpected は固定 operation で report する", async () => {
    const { updateAdminUserDisplayNameAction } = await import(
      "./user-management-actions.ts"
    );
    const error = new Error("db");
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserDisplayName.mockRejectedValue(error);
    await expect(
      callAction(updateAdminUserDisplayNameAction, {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        displayName: "山田 太郎",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "INTERNAL_SERVER_ERROR",
        message: "ユーザーの表示名を更新できませんでした。",
      },
    });
    expect(mocks.report).toHaveBeenCalledWith(
      error,
      "admin.users.action.update-display-name",
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateUserStatus: vi.fn(),
  updateUserDisplayName: vi.fn(),
  getHourlyWageRates: vi.fn(),
  updateHourlyWageRate: vi.fn(),
  deleteHourlyWageRate: vi.fn(),
  createUserApplication: vi.fn(),
  createHourlyApplication: vi.fn(),
  resolve: vi.fn(),
  revalidatePath: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("../../../lib/server/payroll-composition", () => ({
  createHourlyWageRateManagementApplication: mocks.createHourlyApplication,
}));
vi.mock("../../../lib/server/users-access", () => ({
  createTimeCardUserManagementApplication: mocks.createUserApplication,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../lib/server/auth-session", () => ({
  resolveAdminAuthSession: mocks.resolve,
}));
vi.mock("../../../lib/server-observability", () => ({
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
const rateId = "11111111-1111-4111-8111-111111111111";

afterEach(() =>
  Object.values(mocks).forEach((mock) => {
    mock.mockReset();
  }),
);

function application() {
  mocks.createUserApplication.mockReturnValue({
    updateUserStatus: mocks.updateUserStatus,
    updateUserDisplayName: mocks.updateUserDisplayName,
  });
  mocks.createHourlyApplication.mockReturnValue({
    getHourlyWageRates: mocks.getHourlyWageRates,
    updateHourlyWageRate: mocks.updateHourlyWageRate,
    deleteHourlyWageRate: mocks.deleteHourlyWageRate,
  });
}

describe("admin user-management actions", () => {
  test("strict validation rejects malformed and forged input before auth/application", async () => {
    const {
      deleteAdminHourlyWageRateAction,
      getAdminHourlyWageRatesAction,
      updateAdminHourlyWageRateAction,
      updateAdminUserStatusAction,
      updateAdminUserDisplayNameAction,
    } = await import("./user-management-actions.ts");
    await expect(
      updateAdminUserStatusAction({
        userId: "staff-1",
        status: "active",
        role: "admin",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "staff-1",
        displayName: "スタッフ",
        actorUserId: "admin-1",
        role: "admin",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      getAdminHourlyWageRatesAction({
        userId: "staff-1",
        performedByUserId: "admin-1",
      }),
    ).resolves.toEqual({
      status: "error",
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        ...request,
        role: "admin",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      deleteAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        actor: admin.user,
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
  });

  test("expectedVersion は必須の正整数として認証・applicationの前に検証する", async () => {
    const { deleteAdminHourlyWageRateAction, updateAdminHourlyWageRateAction } =
      await import("./user-management-actions.ts");
    const invalidVersions = [undefined, 0, -1, 1.5];
    for (const expectedVersion of invalidVersions) {
      await expect(
        updateAdminHourlyWageRateAction({
          userId: "staff-1",
          hourlyWageRateId: rateId,
          ...request,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        }),
      ).resolves.toEqual({
        success: false,
        message: "リクエスト形式が正しくありません。",
      });
      await expect(
        deleteAdminHourlyWageRateAction({
          userId: "staff-1",
          hourlyWageRateId: rateId,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        }),
      ).resolves.toEqual({
        success: false,
        message: "リクエスト形式が正しくありません。",
      });
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
  });

  test("時給の範囲外値を認証・applicationの前に拒否する", async () => {
    const { updateAdminHourlyWageRateAction } = await import(
      "./user-management-actions.ts"
    );
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        ...versionedRequest,
        hourlyWage: 100_000,
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();

    mocks.resolve.mockResolvedValueOnce(admin);
    application();
  });

  test("auth failure は application を実行せず missing/unavailable/error を区別し、secretを返さない", async () => {
    const { updateAdminUserStatusAction } = await import(
      "./user-management-actions.ts"
    );
    mocks.resolve.mockResolvedValueOnce({
      status: "missing",
      message: "ログインが必要です。",
    });
    const missing = await updateAdminUserStatusAction({
      userId: "staff-1",
      status: "active",
    });
    expect(missing).toEqual({
      success: false,
      code: "SESSION_EXPIRED",
      message: "ログイン状態が切れています。",
    });
    mocks.resolve.mockResolvedValueOnce({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "active" }),
    ).resolves.toEqual({
      success: false,
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });
    mocks.resolve.mockResolvedValueOnce({
      status: "error",
      message: "認証エラー",
    });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "active" }),
    ).resolves.toEqual({ success: false, message: "認証エラー" });
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(missing).not.toHaveProperty("sessionId");
    expect(missing).not.toHaveProperty("actor");
  });

  test("status は exact input、business mapping、成功時の全path再検証を行う", async () => {
    const { updateAdminUserStatusAction } = await import(
      "./user-management-actions.ts"
    );
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserStatus.mockResolvedValueOnce({ kind: "not-found" });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "inactive" }),
    ).resolves.toMatchObject({ code: "USER_NOT_FOUND" });
    mocks.updateUserStatus.mockResolvedValueOnce({ kind: "role-forbidden" });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "inactive" }),
    ).resolves.toMatchObject({ code: "ADMIN_STATUS_UPDATE_FORBIDDEN" });
    mocks.updateUserStatus.mockResolvedValueOnce({
      kind: "transition-forbidden",
    });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "inactive" }),
    ).resolves.toMatchObject({ code: "USER_STATUS_TRANSITION_FORBIDDEN" });
    mocks.updateUserStatus.mockResolvedValueOnce({
      kind: "display-name-required",
    });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "active" }),
    ).resolves.toEqual({
      success: false,
      code: "USER_DISPLAY_NAME_REQUIRED",
      message: "対象スタッフの表示名を設定してから、承認・有効化してください。",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.updateUserStatus.mockResolvedValueOnce({
      kind: "display-name-conflict",
    });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "active" }),
    ).resolves.toEqual({
      success: false,
      code: "USER_DISPLAY_NAME_CONFLICT",
      message:
        "同じ表示名の利用中または停止中スタッフがいるため、有効にできません。対象スタッフの表示名を変更してから再試行してください。",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.updateUserStatus.mockResolvedValueOnce({
      kind: "success",
      userId: "staff-1",
      status: "inactive",
    });
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "inactive" }),
    ).resolves.toEqual({ success: true });
    expect(mocks.updateUserStatus).toHaveBeenLastCalledWith({
      userId: "staff-1",
      status: "inactive",
    });
    expect(mocks.createUserApplication).toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users/staff-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/payroll");
  });

  test("status の unexpected は固定 operation で report する", async () => {
    const { updateAdminUserStatusAction } = await import(
      "./user-management-actions.ts"
    );
    const error = new Error("db");
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserStatus.mockRejectedValue(error);
    await expect(
      updateAdminUserStatusAction({ userId: "staff-1", status: "inactive" }),
    ).resolves.toEqual({
      success: false,
      message: "ユーザーの利用状態を更新できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      error,
      "admin.users.action.update-status",
    );
  });

  test("displayName 更新は strict validation、trim、business mapping、成功時の全path再検証を行う", async () => {
    const { updateAdminUserDisplayNameAction } = await import(
      "./user-management-actions.ts"
    );
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "staff-1",
        displayName: "山田",
        role: "staff",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "staff-1",
        displayName: "   ",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();

    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "display-name-too-long",
    });
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "staff-1",
        displayName: "😀".repeat(101),
      }),
    ).resolves.toEqual({
      success: false,
      code: "USER_DISPLAY_NAME_TOO_LONG",
      message: "表示名は100文字以内で入力してください。",
    });
    for (const [kind, code] of [
      ["not-found", "USER_NOT_FOUND"],
      ["role-forbidden", "ADMIN_DISPLAY_NAME_UPDATE_FORBIDDEN"],
      ["display-name-conflict", "USER_DISPLAY_NAME_CONFLICT"],
    ] as const) {
      mocks.updateUserDisplayName.mockResolvedValueOnce({ kind });
      await expect(
        updateAdminUserDisplayNameAction({
          userId: "staff-1",
          displayName: "  山田 太郎  ",
        }),
      ).resolves.toMatchObject({ success: false, code });
    }
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "role-forbidden",
    });
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "other-admin-1",
        displayName: "別管理者",
      }),
    ).resolves.toEqual({
      success: false,
      code: "ADMIN_DISPLAY_NAME_UPDATE_FORBIDDEN",
      message: "他の管理者の表示名は変更できません。",
    });
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "display-name-conflict",
    });
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "staff-1",
        displayName: "  山田 太郎  ",
      }),
    ).resolves.toEqual({
      success: false,
      code: "USER_DISPLAY_NAME_CONFLICT",
      message:
        "同じ表示名の利用中または停止中の利用者がいるため、表示名を変更できません。別の表示名を入力してください。",
    });
    expect(mocks.updateUserDisplayName).toHaveBeenCalledWith({
      userId: "staff-1",
      displayName: "山田 太郎",
      actorUserId: "admin-1",
    });
    expect(mocks.createUserApplication).toHaveBeenCalled();
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "success",
      userId: "staff-1",
      displayName: "山田 太郎",
    });
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "staff-1",
        displayName: "  山田 太郎  ",
      }),
    ).resolves.toEqual({ success: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users/staff-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff-1/hourly-wage-rates",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff-1/hourly-wage-rates/history",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff-1/payroll",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/attendance");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/payroll");
    mocks.updateUserDisplayName.mockResolvedValueOnce({
      kind: "success",
      userId: "admin-1",
      displayName: "管理者本人",
    });
    await expect(
      updateAdminUserDisplayNameAction({
        userId: "admin-1",
        displayName: "管理者本人",
      }),
    ).resolves.toEqual({ success: true });
    expect(mocks.updateUserDisplayName).toHaveBeenLastCalledWith({
      userId: "admin-1",
      displayName: "管理者本人",
      actorUserId: "admin-1",
    });
  });

  test("詳細URLのuserIdはURLパスとしてencodeして再検証する", async () => {
    const { updateAdminUserDisplayNameAction } = await import(
      "./user-management-actions.ts"
    );
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateUserDisplayName.mockResolvedValue({ kind: "success" });

    await expect(
      updateAdminUserDisplayNameAction({
        userId: "staff/42",
        displayName: "対象スタッフ",
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff%2F42",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff%2F42/hourly-wage-rates",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff%2F42/hourly-wage-rates/history",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff%2F42/payroll",
    );
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
      updateAdminUserDisplayNameAction({
        userId: "staff-1",
        displayName: "山田 太郎",
      }),
    ).resolves.toEqual({
      success: false,
      message: "ユーザーの表示名を更新できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      error,
      "admin.users.action.update-display-name",
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  test("history は user id と business/auth/unexpected error を正しく扱う", async () => {
    const { getAdminHourlyWageRatesAction } = await import(
      "./user-management-actions.ts"
    );
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.getHourlyWageRates.mockResolvedValueOnce({ kind: "user-not-found" });
    await expect(
      getAdminHourlyWageRatesAction({ userId: "staff-1" }),
    ).resolves.toEqual({
      status: "error",
      code: "USER_NOT_FOUND",
      message: "対象ユーザーが見つかりません。",
    });
    mocks.getHourlyWageRates.mockResolvedValueOnce({
      kind: "success",
      hourlyWageRates: [],
    });
    await expect(
      getAdminHourlyWageRatesAction({ userId: "staff-1" }),
    ).resolves.toEqual({ status: "ready", data: [] });
    expect(mocks.getHourlyWageRates).toHaveBeenLastCalledWith("staff-1");
    expect(mocks.createHourlyApplication).toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    const error = new Error("db");
    mocks.getHourlyWageRates.mockRejectedValueOnce(error);
    await expect(
      getAdminHourlyWageRatesAction({ userId: "staff-1" }),
    ).resolves.toEqual({
      status: "error",
      message: "時給ルールの履歴を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      error,
      "admin.hourly-wage.read.rates",
    );
  });

  test("history の auth failure は application を実行せず read state を維持する", async () => {
    const { getAdminHourlyWageRatesAction } = await import(
      "./user-management-actions.ts"
    );
    mocks.resolve.mockResolvedValueOnce({
      status: "missing",
      message: "ログインが必要です。",
    });
    await expect(
      getAdminHourlyWageRatesAction({ userId: "staff-1" }),
    ).resolves.toEqual({ status: "missing", message: "ログインが必要です。" });
    mocks.resolve.mockResolvedValueOnce({
      status: "unavailable",
      code: "ACTOR_NOT_ACTIVE",
      message: "利用できません。",
    });
    await expect(
      getAdminHourlyWageRatesAction({ userId: "staff-1" }),
    ).resolves.toEqual({
      status: "unavailable",
      code: "ACTOR_NOT_ACTIVE",
      message: "利用できません。",
    });
    mocks.resolve.mockResolvedValueOnce({
      status: "error",
      message: "認証状態を確認できませんでした。",
    });
    await expect(
      getAdminHourlyWageRatesAction({ userId: "staff-1" }),
    ).resolves.toEqual({
      status: "error",
      message: "認証状態を確認できませんでした。",
    });
    expect(mocks.createHourlyApplication).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  test("individual update/delete は exact input、uuid validation、business mapping、再検証を行う", async () => {
    const { deleteAdminHourlyWageRateAction, updateAdminHourlyWageRateAction } =
      await import("./user-management-actions.ts");
    await updateAdminHourlyWageRateAction({
      userId: "staff-1",
      hourlyWageRateId: "not-uuid",
      ...versionedRequest,
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue(admin);
    application();
    mocks.updateHourlyWageRate.mockResolvedValueOnce({
      kind: "user-not-found",
    });
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        ...versionedRequest,
      }),
    ).resolves.toMatchObject({ code: "USER_NOT_FOUND" });
    mocks.updateHourlyWageRate.mockResolvedValueOnce({
      kind: "rate-not-found",
    });
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        ...versionedRequest,
      }),
    ).resolves.toMatchObject({ code: "HOURLY_WAGE_RATE_NOT_FOUND" });
    mocks.updateHourlyWageRate.mockResolvedValueOnce({
      kind: "already-exists",
    });
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        ...versionedRequest,
      }),
    ).resolves.toMatchObject({ code: "HOURLY_WAGE_RATE_ALREADY_EXISTS" });
    mocks.deleteHourlyWageRate.mockResolvedValueOnce({
      kind: "user-not-found",
    });
    await expect(
      deleteAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ code: "USER_NOT_FOUND" });
    mocks.deleteHourlyWageRate.mockResolvedValueOnce({
      kind: "rate-not-found",
    });
    await expect(
      deleteAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ code: "HOURLY_WAGE_RATE_NOT_FOUND" });
    mocks.updateHourlyWageRate.mockResolvedValueOnce({
      kind: "version-conflict",
    });
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        ...versionedRequest,
      }),
    ).resolves.toEqual({
      success: false,
      code: "HOURLY_WAGE_RATE_VERSION_CONFLICT",
      message:
        "対象の時給ルールは他の操作により変更されています。最新の内容を確認してから再操作してください。",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.deleteHourlyWageRate.mockResolvedValueOnce({
      kind: "version-conflict",
    });
    await expect(
      deleteAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual({
      success: false,
      code: "HOURLY_WAGE_RATE_VERSION_CONFLICT",
      message:
        "対象の時給ルールは他の操作により変更されています。最新の内容を確認してから再操作してください。",
    });
    mocks.updateHourlyWageRate.mockResolvedValueOnce({
      kind: "success",
      hourlyWageRate: { id: rateId },
    });
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        ...versionedRequest,
      }),
    ).resolves.toEqual({ success: true });
    expect(mocks.updateHourlyWageRate).toHaveBeenLastCalledWith({
      userId: "staff-1",
      hourlyWageRateId: rateId,
      ...versionedRequest,
      actorUserId: "admin-1",
    });
    mocks.deleteHourlyWageRate.mockResolvedValueOnce({
      kind: "success",
      hourlyWageRateId: rateId,
    });
    await expect(
      deleteAdminHourlyWageRateAction({
        userId: "staff-1",
        hourlyWageRateId: rateId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual({ success: true });
    expect(mocks.deleteHourlyWageRate).toHaveBeenLastCalledWith({
      userId: "staff-1",
      hourlyWageRateId: rateId,
      expectedVersion: 1,
      actorUserId: "admin-1",
    });
    expect(mocks.createHourlyApplication).toHaveBeenCalled();
    expect(mocks.createUserApplication).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff-1/hourly-wage-rates",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff-1/hourly-wage-rates/history",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/users/staff-1/payroll",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/payroll");
  });

  test("role-forbidden は固定結果を返し、再検証・例外報告を行わない", async () => {
    const { deleteAdminHourlyWageRateAction, updateAdminHourlyWageRateAction } =
      await import("./user-management-actions.ts");
    mocks.resolve.mockResolvedValue(admin);
    application();
    const forbidden = {
      success: false as const,
      code: "HOURLY_WAGE_RATE_UPDATE_FORBIDDEN" as const,
      message: "他の管理者の時給ルールは変更できません。",
    };
    mocks.updateHourlyWageRate.mockResolvedValueOnce({
      kind: "role-forbidden",
    });
    await expect(
      updateAdminHourlyWageRateAction({
        userId: "admin-2",
        hourlyWageRateId: rateId,
        ...versionedRequest,
      }),
    ).resolves.toEqual(forbidden);
    mocks.deleteHourlyWageRate.mockResolvedValueOnce({
      kind: "role-forbidden",
    });
    await expect(
      deleteAdminHourlyWageRateAction({
        userId: "admin-2",
        hourlyWageRateId: rateId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual(forbidden);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  test("individual update/delete の unexpected は固定 operation で report する", async () => {
    const { deleteAdminHourlyWageRateAction, updateAdminHourlyWageRateAction } =
      await import("./user-management-actions.ts");
    mocks.resolve.mockResolvedValue(admin);
    application();
    const updateError = new Error("update");
    const deleteError = new Error("delete");
    mocks.updateHourlyWageRate.mockRejectedValueOnce(updateError);
    mocks.deleteHourlyWageRate.mockRejectedValueOnce(deleteError);
    await updateAdminHourlyWageRateAction({
      userId: "staff-1",
      hourlyWageRateId: rateId,
      ...versionedRequest,
    });
    await deleteAdminHourlyWageRateAction({
      userId: "staff-1",
      hourlyWageRateId: rateId,
      expectedVersion: 1,
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

"use server";

import {
  updateUserDisplayNameRequestSchema,
  updateUserStatusRequestSchema,
} from "@repo/contracts";
import {
  bulkUpdateHourlyWageRatesRequestSchema,
  deleteHourlyWageRateRequestSchema,
  updateHourlyWageRateRequestSchema,
} from "@repo/payroll/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  AdminHourlyWageRatesState,
  AdminUserManagementActionResult,
} from "../../../lib/admin-user-management-types";
import { resolveAdminAuthSession } from "../../../lib/server/auth-session";
import { createHourlyWageRateManagementApplication } from "../../../lib/server/payroll-composition";
import { createTimeCardUserManagementApplication } from "../../../lib/server/users-access";
import { reportUnexpectedServerException } from "../../../lib/server-observability";

const invalidRequestMessage = "リクエスト形式が正しくありません。";
const userIdSchema = z.string();
const hourlyWageRateIdSchema = z.string().uuid();
const hourlyWageRatesInputSchema = z.object({ userId: userIdSchema }).strict();
const updateUserStatusInputSchema = z
  .object({
    userId: userIdSchema,
    status: updateUserStatusRequestSchema.shape.status,
  })
  .strict();
const updateUserDisplayNameInputSchema = z
  .object({
    userId: userIdSchema,
    displayName: updateUserDisplayNameRequestSchema.shape.displayName,
  })
  .strict();
const updateHourlyWageRateInputSchema = z
  .object({ userId: userIdSchema, hourlyWageRateId: hourlyWageRateIdSchema })
  .extend(updateHourlyWageRateRequestSchema.shape)
  .strict();
const deleteHourlyWageRateInputSchema = z
  .object({ userId: userIdSchema, hourlyWageRateId: hourlyWageRateIdSchema })
  .extend(deleteHourlyWageRateRequestSchema.shape)
  .strict();
const bulkHourlyWageRatesInputSchema = z
  .object({ userId: userIdSchema })
  .extend(bulkUpdateHourlyWageRatesRequestSchema.shape)
  .strict();

const hourlyWageRateVersionConflictMessage =
  "対象の時給ルールは他の操作により変更されています。最新の内容を確認してから再操作してください。";

function invalidRequest(): AdminUserManagementActionResult {
  return { success: false, message: invalidRequestMessage };
}

async function resolveActionAuth(): Promise<
  | { success: true; actorUserId: string }
  | { success: false; result: AdminUserManagementActionResult }
> {
  const session = await resolveAdminAuthSession();
  if (session.status === "ready")
    return { success: true, actorUserId: session.user.userId };
  if (session.status === "missing")
    return {
      success: false,
      result: {
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
    };
  if (session.status === "unavailable")
    return {
      success: false,
      result: { success: false, code: session.code, message: session.message },
    };
  return {
    success: false,
    result: { success: false, message: session.message },
  };
}

function readAuthState(
  session: Awaited<ReturnType<typeof resolveAdminAuthSession>>,
): Exclude<AdminHourlyWageRatesState, { status: "ready" }> {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  if (session.status === "unavailable")
    return {
      status: session.status,
      code: session.code,
      message: session.message,
    };
  return { status: session.status, message: session.message };
}

function revalidateUserPaths(userId: string) {
  const encodedUserId = encodeURIComponent(userId);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${encodedUserId}`);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rates`);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rates/history`);
  revalidatePath(`/admin/users/${encodedUserId}/payroll`);
  revalidatePath("/admin/attendance");
  revalidatePath("/admin/payroll");
}

function revalidateHourlyWagePaths(userId: string) {
  const encodedUserId = encodeURIComponent(userId);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rates`);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rates/history`);
  revalidatePath(`/admin/users/${encodedUserId}/payroll`);
  revalidatePath("/admin/payroll");
}

export async function getAdminHourlyWageRatesAction(
  input: unknown,
): Promise<AdminHourlyWageRatesState> {
  const parsed = hourlyWageRatesInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "error", message: invalidRequestMessage };
  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return readAuthState(session);
  try {
    const result =
      await createHourlyWageRateManagementApplication().getHourlyWageRates(
        parsed.data.userId,
      );
    if (result.kind === "user-not-found")
      return {
        status: "error",
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      };
    return { status: "ready", data: result.hourlyWageRates };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.hourly-wage.read.rates");
    return {
      status: "error",
      message: "時給ルールの履歴を取得できませんでした。",
    };
  }
}

export async function updateAdminUserStatusAction(
  input: unknown,
): Promise<AdminUserManagementActionResult> {
  const parsed = updateUserStatusInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const auth = await resolveActionAuth();
  if (!auth.success) return auth.result;
  try {
    const result =
      await createTimeCardUserManagementApplication().updateUserStatus(
        parsed.data,
      );
    if (result.kind === "not-found")
      return {
        success: false,
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      };
    if (result.kind === "role-forbidden")
      return {
        success: false,
        code: "ADMIN_STATUS_UPDATE_FORBIDDEN",
        message: "管理者の利用状態は変更できません。",
      };
    if (result.kind === "transition-forbidden")
      return {
        success: false,
        code: "USER_STATUS_TRANSITION_FORBIDDEN",
        message: "この利用状態への変更はできません。",
      };
    if (result.kind === "display-name-required")
      return {
        success: false,
        code: "USER_DISPLAY_NAME_REQUIRED",
        message:
          "対象スタッフの表示名を設定してから、承認・有効化してください。",
      };
    if (result.kind === "display-name-too-long")
      return {
        success: false,
        code: "USER_DISPLAY_NAME_TOO_LONG",
        message: "表示名は100文字以内で入力してください。",
      };
    if (result.kind === "display-name-conflict")
      return {
        success: false,
        code: "USER_DISPLAY_NAME_CONFLICT",
        message:
          "同じ表示名の利用中または停止中スタッフがいるため、有効にできません。対象スタッフの表示名を変更してから再試行してください。",
      };
    revalidateUserPaths(parsed.data.userId);
    return { success: true };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.users.action.update-status");
    return {
      success: false,
      message: "ユーザーの利用状態を更新できませんでした。",
    };
  }
}

export async function updateAdminUserDisplayNameAction(
  input: unknown,
): Promise<AdminUserManagementActionResult> {
  const parsed = updateUserDisplayNameInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const auth = await resolveActionAuth();
  if (!auth.success) return auth.result;
  try {
    const result =
      await createTimeCardUserManagementApplication().updateUserDisplayName({
        ...parsed.data,
        actorUserId: auth.actorUserId,
      });
    if (result.kind === "not-found")
      return {
        success: false,
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      };
    if (result.kind === "role-forbidden")
      return {
        success: false,
        code: "ADMIN_DISPLAY_NAME_UPDATE_FORBIDDEN",
        message: "他の管理者の表示名は変更できません。",
      };
    if (result.kind === "display-name-required") return invalidRequest();
    if (result.kind === "display-name-too-long")
      return {
        success: false,
        code: "USER_DISPLAY_NAME_TOO_LONG",
        message: "表示名は100文字以内で入力してください。",
      };
    if (result.kind === "display-name-conflict")
      return {
        success: false,
        code: "USER_DISPLAY_NAME_CONFLICT",
        message:
          "同じ表示名の利用中または停止中の利用者がいるため、表示名を変更できません。別の表示名を入力してください。",
      };
    revalidateUserPaths(parsed.data.userId);
    return { success: true };
  } catch (error) {
    reportUnexpectedServerException(
      error,
      "admin.users.action.update-display-name",
    );
    return {
      success: false,
      message: "ユーザーの表示名を更新できませんでした。",
    };
  }
}

export async function updateAdminHourlyWageRateAction(
  input: unknown,
): Promise<AdminUserManagementActionResult> {
  const parsed = updateHourlyWageRateInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const auth = await resolveActionAuth();
  if (!auth.success) return auth.result;
  try {
    const result =
      await createHourlyWageRateManagementApplication().updateHourlyWageRate({
        ...parsed.data,
        actorUserId: auth.actorUserId,
      });
    if (result.kind === "user-not-found")
      return {
        success: false,
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      };
    if (result.kind === "role-forbidden")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_UPDATE_FORBIDDEN",
        message: "他の管理者の時給ルールは変更できません。",
      };
    if (result.kind === "rate-not-found")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_NOT_FOUND",
        message: "対象の時給ルールが見つかりません。",
      };
    if (result.kind === "version-conflict")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_VERSION_CONFLICT",
        message: hourlyWageRateVersionConflictMessage,
      };
    if (result.kind === "already-exists")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_ALREADY_EXISTS",
        message: "同じ条件の時給ルールが既に登録されています。",
      };
    revalidateHourlyWagePaths(parsed.data.userId);
    return { success: true };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.hourly-wage.action.update");
    return { success: false, message: "時給ルールを更新できませんでした。" };
  }
}

export async function bulkUpdateAdminHourlyWageRatesAction(
  input: unknown,
): Promise<AdminUserManagementActionResult> {
  const parsed = bulkHourlyWageRatesInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const auth = await resolveActionAuth();
  if (!auth.success) return auth.result;
  try {
    const result =
      await createHourlyWageRateManagementApplication().bulkUpdateHourlyWageRates(
        {
          ...parsed.data,
          actorUserId: auth.actorUserId,
        },
      );
    if (result.kind === "user-not-found")
      return {
        success: false,
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      };
    if (result.kind === "role-forbidden")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_UPDATE_FORBIDDEN",
        message: "他の管理者の時給ルールは変更できません。",
      };
    if (result.kind === "bulk-conflict")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_BULK_CONFLICT",
        message: hourlyWageRateVersionConflictMessage,
      };
    revalidateHourlyWagePaths(parsed.data.userId);
    return { success: true };
  } catch (error) {
    reportUnexpectedServerException(
      error,
      "admin.hourly-wage.action.bulk-update",
    );
    return { success: false, message: "時給を更新できませんでした。" };
  }
}

export async function deleteAdminHourlyWageRateAction(
  input: unknown,
): Promise<AdminUserManagementActionResult> {
  const parsed = deleteHourlyWageRateInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const auth = await resolveActionAuth();
  if (!auth.success) return auth.result;
  try {
    const result =
      await createHourlyWageRateManagementApplication().deleteHourlyWageRate({
        ...parsed.data,
        actorUserId: auth.actorUserId,
      });
    if (result.kind === "user-not-found")
      return {
        success: false,
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      };
    if (result.kind === "role-forbidden")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_UPDATE_FORBIDDEN",
        message: "他の管理者の時給ルールは変更できません。",
      };
    if (result.kind === "rate-not-found")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_NOT_FOUND",
        message: "対象の時給ルールが見つかりません。",
      };
    if (result.kind === "version-conflict")
      return {
        success: false,
        code: "HOURLY_WAGE_RATE_VERSION_CONFLICT",
        message: hourlyWageRateVersionConflictMessage,
      };
    revalidateHourlyWagePaths(parsed.data.userId);
    return { success: true };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.hourly-wage.action.delete");
    return { success: false, message: "時給ルールを削除できませんでした。" };
  }
}

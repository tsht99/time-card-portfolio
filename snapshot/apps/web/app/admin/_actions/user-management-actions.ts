"use server";

import {
  updateUserAccessStatusRequestSchema,
  updateUserDisplayNameRequestSchema,
} from "@repo/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionSession,
  actionClient,
  authenticatedActionMiddleware,
  returnServerError,
} from "../../../lib/server/action-client";
import { createTimeCardUserManagementApplication } from "../../../lib/server/users-composition";
import { displayNameTooLongMessage } from "../_lib/user-management-messages.ts";

const userIdSchema = z.uuid("userId はUUID形式で指定してください。");

const updateAccessInputSchema = z
  .object({
    userId: userIdSchema,
    status: updateUserAccessStatusRequestSchema.shape.status,
  })
  .strict();
const updateDisplayNameInputSchema = z
  .object({
    userId: userIdSchema,
    displayName: updateUserDisplayNameRequestSchema.shape.displayName,
  })
  .strict();

function authFailure(session: ActionSession): never {
  if (session.status === "missing")
    return returnServerError({
      code: "SESSION_EXPIRED",
      message: "ログイン状態が切れています。",
    });
  return returnServerError({ code: "ACTION_FAILED", message: session.message });
}
function revalidateUserPaths(userId: string) {
  const encodedUserId = encodeURIComponent(userId);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${encodedUserId}`);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rules`);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rules/history`);
  revalidatePath(`/admin/users/${encodedUserId}/payroll-estimates`);
  revalidatePath("/admin/attendance");
  revalidatePath("/admin/payroll-estimates");
}

export const updateAdminUserAccessStatusAction = actionClient
  .inputSchema(updateAccessInputSchema)
  .metadata({
    operation: "admin.users.action.update-access-status",
    fallback: "ユーザーの利用状態を更新できませんでした。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    const result =
      await createTimeCardUserManagementApplication().updateUserAccessStatus({
        ...parsedInput,
        actorUserId: ctx.session.user.userId,
      });
    if (result.kind === "actor-forbidden")
      return returnServerError({
        code: result.code,
        message:
          result.code === "ACTOR_NOT_ACTIVE"
            ? "アカウントが利用できないため、操作を続けられません。"
            : "この操作を行う権限がありません。",
      });
    if (result.kind === "not-found")
      return returnServerError({
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      });
    if (result.kind === "role-forbidden")
      return returnServerError({
        code: "ADMIN_ACCESS_STATUS_UPDATE_FORBIDDEN",
        message: "管理者の利用状態は変更できません。",
      });
    if (result.kind === "transition-forbidden")
      return returnServerError({
        code: "USER_ACCESS_STATUS_TRANSITION_FORBIDDEN",
        message: "この利用状態への変更はできません。",
      });
    if (result.kind === "display-name-required")
      return returnServerError({
        code: "USER_DISPLAY_NAME_REQUIRED",
        message:
          "対象スタッフの表示名を設定してから、承認・有効化してください。",
      });
    if (result.kind === "display-name-too-long")
      return returnServerError({
        code: "USER_DISPLAY_NAME_TOO_LONG",
        message: displayNameTooLongMessage,
      });
    if (result.kind === "display-name-conflict")
      return returnServerError({
        code: "USER_DISPLAY_NAME_CONFLICT",
        message:
          "同じ表示名の利用中または停止中スタッフがいるため、有効にできません。対象スタッフの表示名を変更してから再試行してください。",
      });
    revalidateUserPaths(parsedInput.userId);
    return;
  });

export const updateAdminUserDisplayNameAction = actionClient
  .inputSchema(updateDisplayNameInputSchema)
  .metadata({
    operation: "admin.users.action.update-display-name",
    fallback: "ユーザーの表示名を更新できませんでした。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    const result =
      await createTimeCardUserManagementApplication().updateUserDisplayName({
        ...parsedInput,
        actorUserId: ctx.session.user.userId,
      });
    if (result.kind === "not-found")
      return returnServerError({
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      });
    if (result.kind === "actor-forbidden")
      return returnServerError({
        code: result.code,
        message:
          result.code === "ACTOR_NOT_ACTIVE"
            ? "アカウントが利用できないため、操作を続けられません。"
            : "この操作を行う権限がありません。",
      });
    if (result.kind === "role-forbidden")
      return returnServerError({
        code: "ADMIN_DISPLAY_NAME_UPDATE_FORBIDDEN",
        message: "他の管理者の表示名は変更できません。",
      });
    if (result.kind === "display-name-required")
      return returnServerError({
        code: "ACTION_FAILED",
        message: "リクエスト形式が正しくありません。",
      });
    if (result.kind === "display-name-too-long")
      return returnServerError({
        code: "USER_DISPLAY_NAME_TOO_LONG",
        message: displayNameTooLongMessage,
      });
    if (result.kind === "display-name-conflict")
      return returnServerError({
        code: "USER_DISPLAY_NAME_CONFLICT",
        message:
          "同じ表示名の利用中または停止中の利用者がいるため、表示名を変更できません。別の表示名を入力してください。",
      });
    revalidateUserPaths(parsedInput.userId);
    return;
  });

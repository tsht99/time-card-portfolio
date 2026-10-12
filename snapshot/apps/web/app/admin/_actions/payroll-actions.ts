"use server";

import {
  attendanceUserIdSchema,
  bulkUpdateHourlyWageRulesRequestSchema,
  deleteHourlyWageRuleRequestSchema,
  updateHourlyWageRuleRequestSchema,
} from "@repo/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionSession,
  actionClient,
  authenticatedActionMiddleware,
  returnServerError,
} from "../../../lib/server/action-client";
import { createHourlyWageRuleManagementApplication } from "../../../lib/server/payroll-composition";

const hourlyWageRuleIdSchema = z.uuid();
const updateInputSchema = z
  .object({
    userId: attendanceUserIdSchema,
    hourlyWageRuleId: hourlyWageRuleIdSchema,
  })
  .extend(updateHourlyWageRuleRequestSchema.shape)
  .strict();
const deleteInputSchema = z
  .object({
    userId: attendanceUserIdSchema,
    hourlyWageRuleId: hourlyWageRuleIdSchema,
  })
  .extend(deleteHourlyWageRuleRequestSchema.shape)
  .strict();
const bulkInputSchema = z
  .object({ userId: attendanceUserIdSchema })
  .extend(bulkUpdateHourlyWageRulesRequestSchema.shape)
  .strict();
const conflictMessage =
  "対象の時給ルールは他の操作により変更されています。最新の内容を確認してから再操作してください。";

function authFailure(session: ActionSession): never {
  if (session.status === "missing")
    return returnServerError({
      code: "SESSION_EXPIRED",
      message: "ログイン状態が切れています。",
    });
  return returnServerError({ code: "ACTION_FAILED", message: session.message });
}
function revalidateHourlyWagePaths(userId: string) {
  const encodedUserId = encodeURIComponent(userId);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rules`);
  revalidatePath(`/admin/users/${encodedUserId}/hourly-wage-rules/history`);
  revalidatePath(`/admin/users/${encodedUserId}/payroll-estimates`);
  revalidatePath("/admin/payroll-estimates");
}

export const updateAdminHourlyWageRuleAction = actionClient
  .inputSchema(updateInputSchema)
  .metadata({
    operation: "admin.hourly-wage.action.update",
    fallback: "時給ルールを更新できませんでした。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    const result =
      await createHourlyWageRuleManagementApplication().updateHourlyWageRule({
        ...parsedInput,
        actorUserId: ctx.session.user.userId,
      });
    if (result.kind === "user-not-found")
      return returnServerError({
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      });
    if (result.kind === "role-forbidden")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_UPDATE_FORBIDDEN",
        message: "他の管理者の時給ルールは変更できません。",
      });
    if (result.kind === "rule-not-found")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_NOT_FOUND",
        message: "対象の時給ルールが見つかりません。",
      });
    if (result.kind === "version-conflict")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_VERSION_CONFLICT",
        message: conflictMessage,
      });
    if (result.kind === "already-exists")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_ALREADY_EXISTS",
        message: "同じ条件の時給ルールが既に登録されています。",
      });
    revalidateHourlyWagePaths(parsedInput.userId);
    return;
  });

export const bulkUpdateAdminHourlyWageRulesAction = actionClient
  .inputSchema(bulkInputSchema)
  .metadata({
    operation: "admin.hourly-wage.action.bulk-update",
    fallback: "時給を更新できませんでした。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    const result =
      await createHourlyWageRuleManagementApplication().bulkUpdateHourlyWageRules(
        { ...parsedInput, actorUserId: ctx.session.user.userId },
      );
    if (result.kind === "user-not-found")
      return returnServerError({
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      });
    if (result.kind === "role-forbidden")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_UPDATE_FORBIDDEN",
        message: "他の管理者の時給ルールは変更できません。",
      });
    if (result.kind === "bulk-conflict")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_BULK_CONFLICT",
        message: conflictMessage,
      });
    revalidateHourlyWagePaths(parsedInput.userId);
    return;
  });

export const deleteAdminHourlyWageRuleAction = actionClient
  .inputSchema(deleteInputSchema)
  .metadata({
    operation: "admin.hourly-wage.action.delete",
    fallback: "時給ルールを削除できませんでした。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    const result =
      await createHourlyWageRuleManagementApplication().deleteHourlyWageRule({
        ...parsedInput,
        actorUserId: ctx.session.user.userId,
      });
    if (result.kind === "user-not-found")
      return returnServerError({
        code: "USER_NOT_FOUND",
        message: "対象ユーザーが見つかりません。",
      });
    if (result.kind === "role-forbidden")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_UPDATE_FORBIDDEN",
        message: "他の管理者の時給ルールは変更できません。",
      });
    if (result.kind === "rule-not-found")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_NOT_FOUND",
        message: "対象の時給ルールが見つかりません。",
      });
    if (result.kind === "version-conflict")
      return returnServerError({
        code: "HOURLY_WAGE_RULE_VERSION_CONFLICT",
        message: conflictMessage,
      });
    revalidateHourlyWagePaths(parsedInput.userId);
    return;
  });

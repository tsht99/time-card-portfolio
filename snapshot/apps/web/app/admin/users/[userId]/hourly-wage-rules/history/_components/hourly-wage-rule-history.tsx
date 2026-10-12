"use client";

import type {
  HourlyWageRuleResponse,
  UpdateHourlyWageRuleRequest,
} from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { canManageTargetUserData } from "@repo/users";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  deleteAdminHourlyWageRuleAction,
  updateAdminHourlyWageRuleAction,
} from "../../../../../_actions/payroll-actions.ts";
import { useAuth } from "../../../../../_components/auth-provider.tsx";
import { UserContextCard } from "../../../../../_components/user-context-card.tsx";
import {
  AdminClientError,
  runAdminAction,
  throwForActionFailure,
} from "../../../../../_lib/admin-action-client.ts";
import type { AdminUserListState } from "../../../../../_lib/admin-user-management-types.ts";
import type { AdminHourlyWageRulesState } from "../../_lib/admin-hourly-wage-rules-types.ts";
import { getHistoryChanges } from "../_lib/history-model";
import { HourlyWageRuleDeleteDialog } from "./hourly-wage-rule-delete-dialog";
import {
  type HourlyWageRuleDraft,
  HourlyWageRuleEditDialog,
} from "./hourly-wage-rule-edit-dialog";
import { HourlyWageRuleHistoryList } from "./hourly-wage-rule-history-list";

type HourlyWageRule = HourlyWageRuleResponse;

const emptyDraft: HourlyWageRuleDraft = {
  workPeriod: "day",
  dayType: "mon",
  hourlyWage: "",
  effectiveFrom: "",
};

export function HourlyWageRuleHistory({
  initialUsers,
  userId,
  hourlyWageRulesState,
}: {
  initialUsers: AdminUserListState;
  userId: string;
  hourlyWageRulesState: AdminHourlyWageRulesState;
}) {
  const { authState, isRouteDataReady, reauthenticate, canMutate } = useAuth();
  const router = useRouter();
  const [editingHourlyWageRule, setEditingHourlyWageRule] =
    useState<HourlyWageRule | null>(null);
  const [deletingHourlyWageRule, setDeletingHourlyWageRule] =
    useState<HourlyWageRule | null>(null);
  const [draft, setDraft] = useState<HourlyWageRuleDraft>(emptyDraft);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [isUpdating, startUpdateTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [pendingUpdate, setPendingUpdate] = useState<{
    hourlyWageRule: HourlyWageRule;
    request: UpdateHourlyWageRuleRequest;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HourlyWageRule | null>(
    null,
  );
  const updateSubmitting = useRef(false);
  const deleteSubmitting = useRef(false);
  const user =
    initialUsers.status === "ready"
      ? initialUsers.data.find((candidate) => candidate.userId === userId)
      : undefined;
  const canEdit =
    authState.status === "ready" &&
    isRouteDataReady &&
    !!user &&
    canManageTargetUserData(authState.user.userId, user.userId, user.role);
  function beginEdit(hourlyWageRule: HourlyWageRule) {
    if (
      isUpdating ||
      isDeleting ||
      updateSubmitting.current ||
      deleteSubmitting.current
    )
      return;
    setErrorMessage(null);
    setConflictMessage(null);
    setDraft({
      workPeriod: hourlyWageRule.workPeriod,
      dayType: hourlyWageRule.dayType,
      hourlyWage: String(hourlyWageRule.hourlyWage),
      effectiveFrom: hourlyWageRule.effectiveFrom,
    });
    setEditingHourlyWageRule(hourlyWageRule);
  }
  function beginDelete(hourlyWageRule: HourlyWageRule) {
    if (
      isUpdating ||
      isDeleting ||
      updateSubmitting.current ||
      deleteSubmitting.current
    )
      return;
    setErrorMessage(null);
    setConflictMessage(null);
    setDeletingHourlyWageRule(hourlyWageRule);
  }
  function submitUpdate(
    hourlyWageRule: HourlyWageRule,
    request: UpdateHourlyWageRuleRequest,
  ) {
    if (isUpdating || updateSubmitting.current || pendingUpdate !== null)
      return;
    updateSubmitting.current = true;
    setPendingUpdate({ hourlyWageRule, request });
    startUpdateTransition(async () => {
      try {
        const result = await runAdminAction(
          () =>
            updateAdminHourlyWageRuleAction({
              userId,
              hourlyWageRuleId: hourlyWageRule.id,
              ...request,
            }),
          reauthenticate,
          canMutate,
        );
        throwForActionFailure(result);
        setEditingHourlyWageRule(null);
        setErrorMessage(null);
        setConflictMessage(null);
        router.refresh();
      } catch (error) {
        const nextError =
          error instanceof AdminClientError
            ? error
            : new AdminClientError("時給ルールを訂正できませんでした。");
        if (nextError.code === "HOURLY_WAGE_RULE_VERSION_CONFLICT") {
          setEditingHourlyWageRule(null);
          setErrorMessage(null);
          setConflictMessage(nextError.message);
          router.refresh();
        } else setErrorMessage(nextError.message);
      } finally {
        updateSubmitting.current = false;
        setPendingUpdate(null);
      }
    });
  }
  function submitDelete(hourlyWageRule: HourlyWageRule) {
    if (isDeleting || deleteSubmitting.current || pendingDelete !== null)
      return;
    deleteSubmitting.current = true;
    setPendingDelete(hourlyWageRule);
    startDeleteTransition(async () => {
      try {
        const result = await runAdminAction(
          () =>
            deleteAdminHourlyWageRuleAction({
              userId,
              hourlyWageRuleId: hourlyWageRule.id,
              expectedVersion: hourlyWageRule.version,
            }),
          reauthenticate,
          canMutate,
        );
        throwForActionFailure(result);
        setDeletingHourlyWageRule(null);
        setErrorMessage(null);
        setConflictMessage(null);
        router.refresh();
      } catch (error) {
        const nextError =
          error instanceof AdminClientError
            ? error
            : new AdminClientError("時給ルールを削除できませんでした。");
        if (nextError.code === "HOURLY_WAGE_RULE_VERSION_CONFLICT") {
          setDeletingHourlyWageRule(null);
          setErrorMessage(null);
          setConflictMessage(nextError.message);
          router.refresh();
        } else setErrorMessage(nextError.message);
      } finally {
        deleteSubmitting.current = false;
        setPendingDelete(null);
      }
    });
  }

  return (
    <main className="w-full min-w-0 text-zinc-950">
      <section className="w-full min-w-0 p-4">
        {authState.status === "checking" && <p>{authState.message}</p>}
        {(authState.status === "error" ||
          authState.status === "unavailable") && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{authState.message}</AlertDescription>
          </Alert>
        )}
        {authState.status === "ready" && initialUsers.status !== "ready" && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{initialUsers.message}</AlertDescription>
          </Alert>
        )}
        {authState.status === "ready" &&
          initialUsers.status === "ready" &&
          !user && (
            <p className="mt-4 text-sm text-zinc-700">
              ユーザーが見つかりません。
            </p>
          )}
        {authState.status === "ready" && user && (
          <>
            <div className="mt-5">
              <UserContextCard displayName={user.displayName} />
            </div>
            {hourlyWageRulesState.status !== "ready" && (
              <Alert variant="destructive" className="mt-6">
                <AlertDescription>
                  {hourlyWageRulesState.message}
                </AlertDescription>
              </Alert>
            )}
            {hourlyWageRulesState.status === "ready" &&
              (hourlyWageRulesState.data.length === 0 ? (
                <p className="mt-6 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
                  時給履歴はありません。
                </p>
              ) : (
                <HourlyWageRuleHistoryList
                  groups={getHistoryChanges(hourlyWageRulesState.data)}
                  canEdit={canEdit}
                  onEdit={beginEdit}
                  onDelete={beginDelete}
                />
              ))}
            {conflictMessage && (
              <Alert variant="warning" className="mt-4">
                <AlertDescription>{conflictMessage}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </section>
      <HourlyWageRuleEditDialog
        hourlyWageRule={editingHourlyWageRule}
        draft={draft}
        errorMessage={errorMessage}
        pending={isUpdating}
        canSubmit={isRouteDataReady}
        onOpenChange={(open) => {
          if (!open && !isUpdating && !updateSubmitting.current) {
            setEditingHourlyWageRule(null);
            setErrorMessage(null);
          }
        }}
        onCancel={() => {
          if (isUpdating || updateSubmitting.current) return;
          setEditingHourlyWageRule(null);
          setErrorMessage(null);
        }}
        onDraftChange={setDraft}
        onErrorMessageChange={setErrorMessage}
        onSubmit={submitUpdate}
      />
      <HourlyWageRuleDeleteDialog
        hourlyWageRule={deletingHourlyWageRule}
        errorMessage={errorMessage}
        pending={isDeleting}
        canSubmit={isRouteDataReady}
        onOpenChange={(open) => {
          if (!open && !isDeleting && !deleteSubmitting.current) {
            setDeletingHourlyWageRule(null);
            setErrorMessage(null);
          }
        }}
        onCancel={() => {
          if (isDeleting || deleteSubmitting.current) return;
          setDeletingHourlyWageRule(null);
          setErrorMessage(null);
        }}
        onConfirm={submitDelete}
      />
    </main>
  );
}

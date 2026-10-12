"use client";

import type { BulkUpdateHourlyWageRulesRequest } from "@repo/contracts";
import { findApplicableHourlyWageRule, isValidHourlyWage } from "@repo/payroll";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { canManageTargetUserData } from "@repo/users";
import { History, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { getTokyoDate } from "../../../../../../lib/tokyo-date-time";
import { bulkUpdateAdminHourlyWageRulesAction } from "../../../../_actions/payroll-actions.ts";
import { useAuth } from "../../../../_components/auth-provider.tsx";
import { UserContextCard } from "../../../../_components/user-context-card.tsx";
import {
  AdminClientError,
  runAdminAction,
  throwForActionFailure,
} from "../../../../_lib/admin-action-client.ts";
import type { AdminUserListState } from "../../../../_lib/admin-user-management-types.ts";
import type { AdminHourlyWageRulesState } from "../_lib/admin-hourly-wage-rules-types.ts";
import {
  formatEffectiveFrom,
  getAvailableEffectiveFromDates,
  getBulkChanges,
  parseBulkHourlyWageRuleDraft,
  sortHourlyWageRulesByEffectiveFrom,
} from "../_lib/hourly-wage-rule-presentation";
import {
  HourlyWageBulkEditActions,
  HourlyWageBulkEditDate,
} from "./hourly-wage-rule-bulk-edit";
import { HourlyWageMatrix } from "./hourly-wage-rule-matrix";

export function HourlyWageRulesClient({
  initialUsers,
  selectedUserId,
  initialReferenceDate,
  hourlyWageRulesState,
}: {
  initialUsers: AdminUserListState;
  selectedUserId: string;
  initialReferenceDate?: string;
  hourlyWageRulesState: AdminHourlyWageRulesState;
}) {
  const { authState, reauthenticate, canMutate } = useAuth();
  const router = useRouter();
  const [selectedPeriod, setSelectedPeriod] = useState(
    initialReferenceDate ?? "current",
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkDrafts, setBulkDrafts] = useState<Record<string, string>>({});
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [bulkPending, startBulkTransition] = useTransition();
  const [bulkError, setBulkError] = useState<AdminClientError | null>(null);
  const [pendingBulkRequest, setPendingBulkRequest] = useState<{
    userId: string;
    request: BulkUpdateHourlyWageRulesRequest;
  } | null>(null);
  const bulkSubmitting = useRef(false);
  const users = initialUsers.status === "ready" ? initialUsers.data : [];
  const selectedUser = users.find((user) => user.userId === selectedUserId);
  const canEditSelectedUser =
    authState.status === "ready" &&
    initialUsers.status === "ready" &&
    selectedUser !== undefined &&
    canManageTargetUserData(
      authState.user.userId,
      selectedUser.userId,
      selectedUser.role,
    );

  const hourlyWageRules =
    hourlyWageRulesState.status === "ready"
      ? sortHourlyWageRulesByEffectiveFrom(hourlyWageRulesState.data)
      : [];
  const baselineDate =
    selectedPeriod === "current" ? getTokyoDate(new Date()) : selectedPeriod;
  const availableEffectiveFromDates = getAvailableEffectiveFromDates(
    hourlyWageRules,
    selectedUserId,
  );
  const contextualPeriodLabel = (date: string) =>
    `${date.replaceAll("-", "/")}時点`;
  const selectPeriods = availableEffectiveFromDates.filter(
    (period) => period !== initialReferenceDate,
  );
  const hasInvalidBulkDraft = Object.values(bulkDrafts).some(
    (value) =>
      value !== "" &&
      parseBulkHourlyWageRuleDraft(value, isValidHourlyWage) === null,
  );
  const bulkChanges = bulkEditing
    ? getBulkChanges(
        bulkDrafts,
        hourlyWageRules,
        selectedUserId,
        bulkDate,
        isValidHourlyWage,
        findApplicableHourlyWageRule,
      )
    : [];
  function beginBulkEdit() {
    if (
      bulkSubmitting.current ||
      pendingBulkRequest !== null ||
      hourlyWageRulesState.status !== "ready"
    )
      return;
    setBulkDate(baselineDate);
    setBulkDrafts({});
    setPendingDate(null);
    setBulkEditing(true);
    setBulkError(null);
    setConflictMessage(null);
  }
  function saveBulk() {
    if (
      !canEditSelectedUser ||
      bulkSubmitting.current ||
      pendingBulkRequest !== null ||
      hasInvalidBulkDraft ||
      bulkChanges.length === 0
    )
      return;
    const variables = {
      userId: selectedUserId,
      request: { effectiveFrom: bulkDate, changes: bulkChanges },
    };
    bulkSubmitting.current = true;
    setPendingBulkRequest(variables);
    setBulkError(null);
    startBulkTransition(async () => {
      try {
        const result = await runAdminAction(
          () =>
            bulkUpdateAdminHourlyWageRulesAction({
              userId: variables.userId,
              ...variables.request,
            }),
          reauthenticate,
          canMutate,
        );
        throwForActionFailure(result);
        setSelectedPeriod(variables.request.effectiveFrom);
        setBulkEditing(false);
        setBulkDrafts({});
        setSuccessMessage("時給を更新しました。");
        router.refresh();
      } catch (error) {
        const nextError =
          error instanceof AdminClientError
            ? error
            : new AdminClientError("時給を更新できませんでした。");
        setBulkError(nextError);
        if (nextError.code === "HOURLY_WAGE_RULE_BULK_CONFLICT") {
          setBulkDrafts({});
          setConflictMessage(nextError.message);
          router.refresh();
        }
      } finally {
        bulkSubmitting.current = false;
        setPendingBulkRequest(null);
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
        {authState.status === "ready" && (
          <>
            {initialUsers.status !== "ready" && (
              <Alert
                variant={
                  initialUsers.status === "missing" ? "warning" : "destructive"
                }
                className="mt-6"
              >
                <AlertDescription>{initialUsers.message}</AlertDescription>
              </Alert>
            )}
            {initialUsers.status === "ready" && selectedUser && (
              <div className="mt-5">
                <UserContextCard displayName={selectedUser.displayName} />
              </div>
            )}
            {initialUsers.status === "ready" && !selectedUser && (
              <p className="mt-5 text-sm text-zinc-700">
                対象ユーザーが見つかりません。
              </p>
            )}
            {conflictMessage && (
              <Alert variant="warning" className="mt-3">
                <AlertDescription>{conflictMessage}</AlertDescription>
              </Alert>
            )}
            <section
              aria-labelledby="hourly-wage-rule-matrix-heading"
              className="mt-6 min-w-0"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2
                    id="hourly-wage-rule-matrix-heading"
                    className="text-base font-semibold"
                  >
                    時給一覧
                  </h2>
                </div>
                <div className="flex gap-2">
                  <Button
                    render={
                      <Link
                        href={`/admin/users/${encodeURIComponent(selectedUserId)}/hourly-wage-rules/history`}
                      />
                    }
                    variant="outline"
                    size="icon"
                    aria-label="時給履歴"
                    title="時給履歴"
                    className="text-zinc-700"
                  >
                    <History aria-hidden="true" className="size-4" />
                  </Button>
                  {canEditSelectedUser && !bulkEditing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="時給を編集"
                      title="時給を編集"
                      onClick={beginBulkEdit}
                      disabled={
                        hourlyWageRulesState.status !== "ready" || bulkPending
                      }
                      className="text-zinc-700"
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              {bulkEditing ? (
                <HourlyWageBulkEditDate
                  bulkDate={bulkDate}
                  drafts={bulkDrafts}
                  isPending={bulkPending}
                  onDateChange={setBulkDate}
                  onRequestDiscard={setPendingDate}
                />
              ) : (
                <Select
                  value={selectedPeriod}
                  onValueChange={(value) => value && setSelectedPeriod(value)}
                >
                  <SelectTrigger
                    aria-label="時給の適用期間"
                    className="mt-3 bg-white font-normal"
                  >
                    <SelectValue>
                      {(value: string) =>
                        value === "current"
                          ? "現在の時給"
                          : value === initialReferenceDate
                            ? contextualPeriodLabel(value)
                            : formatEffectiveFrom(value)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">現在の時給</SelectItem>
                    {initialReferenceDate && (
                      <SelectItem value={initialReferenceDate}>
                        {contextualPeriodLabel(initialReferenceDate)}
                      </SelectItem>
                    )}
                    {selectPeriods.map((period) => (
                      <SelectItem key={period} value={period}>
                        {formatEffectiveFrom(period)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {hourlyWageRulesState.status !== "ready" && (
                <Alert
                  variant={
                    hourlyWageRulesState.status === "missing"
                      ? "warning"
                      : "destructive"
                  }
                  className="mt-4"
                >
                  <AlertDescription>
                    {hourlyWageRulesState.message}
                  </AlertDescription>
                </Alert>
              )}
              {hourlyWageRulesState.status === "ready" && (
                <div className="mt-3 rounded-md border border-zinc-200 bg-white">
                  <HourlyWageMatrix
                    hourlyWageRules={hourlyWageRules}
                    userId={selectedUserId}
                    baselineDate={bulkEditing ? bulkDate : baselineDate}
                    editing={bulkEditing}
                    drafts={bulkDrafts}
                    onDraftChange={(key, value) =>
                      setBulkDrafts((current) => ({
                        ...current,
                        [key]: value,
                      }))
                    }
                    disabled={bulkPending}
                    isValidHourlyWage={isValidHourlyWage}
                    findApplicableHourlyWageRule={findApplicableHourlyWageRule}
                  />
                </div>
              )}
            </section>
            {successMessage && (
              <Alert variant="success" role="status" className="mt-4">
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}
            {bulkEditing && (
              <HourlyWageBulkEditActions
                isPending={bulkPending}
                hasInvalidDraft={hasInvalidBulkDraft}
                hasChanges={bulkChanges.length > 0}
                errorMessage={bulkError?.message}
                pendingDate={pendingDate}
                onCancel={() => {
                  setBulkEditing(false);
                  setBulkDrafts({});
                  setPendingDate(null);
                  setBulkError(null);
                }}
                onSave={saveBulk}
                onDismissDiscard={() => setPendingDate(null)}
                onConfirmDiscard={(date) => {
                  setBulkDrafts({});
                  setBulkDate(date);
                  setPendingDate(null);
                }}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}

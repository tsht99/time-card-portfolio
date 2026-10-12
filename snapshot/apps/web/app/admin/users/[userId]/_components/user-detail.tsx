"use client";

import type { UserListItem } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import {
  canManageTargetUserData,
  MAX_DISPLAY_NAME_CODE_POINTS,
} from "@repo/users";
import { CircleCheck, CirclePause, CirclePlay } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  updateAdminUserAccessStatusAction,
  updateAdminUserDisplayNameAction,
} from "../../../_actions/user-management-actions.ts";
import { useAuth } from "../../../_components/auth-provider.tsx";
import { NavigationCard } from "../../../_components/navigation-card.tsx";
import { UserContextCard } from "../../../_components/user-context-card.tsx";
import {
  AdminClientError,
  runAdminAction,
  throwForActionFailure,
} from "../../../_lib/admin-action-client.ts";
import type { AdminUserListState } from "../../../_lib/admin-user-management-types.ts";
import { displayNameTooLongMessage } from "../../../_lib/user-management-messages.ts";
import { UserAccessStatusDialog } from "./user-access-status-dialog";

type StaffStatus = "pending" | "active" | "inactive";
type StatusTarget = {
  user: UserListItem;
  nextStatus: "active" | "inactive";
};

function statusLabel(status: UserListItem["status"]) {
  return status === "active"
    ? "利用中"
    : status === "inactive"
      ? "利用停止"
      : "承認待ち";
}

function roleLabel(role: UserListItem["role"]) {
  return role === "admin" ? "管理者" : "スタッフ";
}

function statusActionLabel(status: StaffStatus) {
  return status === "pending"
    ? "承認する"
    : status === "active"
      ? "利用を停止する"
      : "再有効化する";
}

function statusDialogTitle(status: StaffStatus) {
  return status === "pending"
    ? "利用承認"
    : status === "active"
      ? "利用停止"
      : "再有効化";
}

function nextStatus(status: StaffStatus): "active" | "inactive" {
  return status === "active" ? "inactive" : "active";
}

function StatusActionIcon({ status }: { status: StaffStatus }) {
  if (status === "active") {
    return <CirclePause aria-hidden="true" className="size-5" />;
  }
  if (status === "pending") {
    return <CircleCheck aria-hidden="true" className="size-5" />;
  }
  return <CirclePlay aria-hidden="true" className="size-5" />;
}

function DetailContent({
  user,
  currentUserId,
  currentMonth,
}: {
  user: UserListItem;
  currentUserId: string;
  currentMonth: string;
}) {
  const router = useRouter();
  const { reauthenticate, canMutate } = useAuth();
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [displayNameValidationError, setDisplayNameValidationError] = useState<
    string | null
  >(null);

  const [statusPending, startStatusTransition] = useTransition();
  const [displayNamePending, startDisplayNameTransition] = useTransition();
  const [statusError, setStatusError] = useState<AdminClientError | null>(null);
  const [displayNameError, setDisplayNameError] =
    useState<AdminClientError | null>(null);
  const statusSubmitting = useRef(false);
  const displayNameSubmitting = useRef(false);

  const isMutationPending = statusPending || displayNamePending;
  const canEditDisplayName = canManageTargetUserData(
    currentUserId,
    user.userId,
    user.role,
  );

  function requestStatusChange() {
    if (
      isMutationPending ||
      user.role !== "staff" ||
      (user.status !== "pending" &&
        user.status !== "active" &&
        user.status !== "inactive")
    )
      return;
    setStatusError(null);
    setStatusTarget({ user, nextStatus: nextStatus(user.status) });
  }

  function startDisplayNameEdit() {
    if (!canEditDisplayName || isMutationPending) return;
    setDisplayNameError(null);
    setDisplayNameInput(user.displayName ?? "");
    setDisplayNameValidationError(null);
    setEditingUser(user);
  }

  function closeDisplayNameEdit() {
    if (displayNameSubmitting.current) return;
    setEditingUser(null);
    setDisplayNameInput("");
    setDisplayNameValidationError(null);
    setDisplayNameError(null);
  }

  function saveDisplayName() {
    if (!editingUser || displayNameSubmitting.current) return;
    const displayName = displayNameInput.trim();
    if (!displayName) {
      setDisplayNameValidationError("表示名を入力してください。");
      setDisplayNameError(null);
      return;
    }
    if (Array.from(displayName).length > MAX_DISPLAY_NAME_CODE_POINTS) {
      setDisplayNameValidationError(displayNameTooLongMessage);
      setDisplayNameError(null);
      return;
    }
    setDisplayNameValidationError(null);
    displayNameSubmitting.current = true;
    setDisplayNameError(null);
    startDisplayNameTransition(async () => {
      try {
        const result = await runAdminAction(
          () =>
            updateAdminUserDisplayNameAction({
              userId: editingUser.userId,
              displayName,
            }),
          reauthenticate,
          canMutate,
        );
        throwForActionFailure(result);
        setEditingUser(null);
        setDisplayNameInput("");
        setDisplayNameValidationError(null);
        router.refresh();
      } catch (error) {
        setDisplayNameError(
          error instanceof AdminClientError
            ? error
            : new AdminClientError("表示名を更新できませんでした。"),
        );
      } finally {
        displayNameSubmitting.current = false;
      }
    });
  }

  const operationLabel = statusActionLabel(user.status);

  return (
    <>
      <UserContextCard
        displayName={user.displayName}
        onEditDisplayName={
          canEditDisplayName ? startDisplayNameEdit : undefined
        }
        editDisabled={isMutationPending}
      />
      <h2 className="mt-6 mb-2 text-sm font-semibold text-zinc-600">
        基本情報
      </h2>
      <dl className="w-full min-w-0">
        <div className="flex min-h-14 min-w-0 items-center gap-3 border-b border-zinc-200 py-2">
          <dt className="w-24 shrink-0 text-sm text-zinc-600">権限</dt>
          <dd className="min-w-0 flex-1 break-words text-right font-medium">
            {roleLabel(user.role)}
          </dd>
          <div className="w-11 shrink-0" aria-hidden="true" />
        </div>
        <div className="flex min-h-14 min-w-0 items-center gap-3 border-b border-zinc-200 py-2">
          <dt className="w-24 shrink-0 text-sm text-zinc-600">利用状態</dt>
          <dd className="min-w-0 flex-1 break-words text-right font-medium">
            {statusLabel(user.status)}
          </dd>
          <div className="flex w-11 shrink-0 justify-end">
            {user.role === "staff" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={operationLabel}
                disabled={isMutationPending}
                onClick={requestStatusChange}
                className="text-zinc-700"
              >
                <StatusActionIcon status={user.status} />
              </Button>
            )}
          </div>
        </div>
      </dl>
      <section aria-label="関連ページ" className="mt-6 grid gap-3">
        <NavigationCard
          href={`/admin/users/${encodeURIComponent(user.userId)}/hourly-wage-rules`}
        >
          時給設定
        </NavigationCard>
        <NavigationCard
          href={`/admin/users/${encodeURIComponent(user.userId)}/payroll-estimates?month=${currentMonth}`}
        >
          給与見込み詳細
        </NavigationCard>
      </section>
      {statusTarget && (
        <UserAccessStatusDialog
          open
          displayName={statusTarget.user.displayName ?? "名前未設定"}
          currentStatus={statusLabel(statusTarget.user.status)}
          nextStatus={statusLabel(statusTarget.nextStatus)}
          title={statusDialogTitle(statusTarget.user.status)}
          actionLabel={operationLabel}
          pending={statusPending}
          errorMessage={statusError?.message ?? null}
          onOpenChange={(open) => {
            if (!open && !statusSubmitting.current) {
              setStatusTarget(null);
              setStatusError(null);
            }
          }}
          onConfirm={() => {
            if (!statusTarget || statusSubmitting.current) return;
            statusSubmitting.current = true;
            setStatusError(null);
            startStatusTransition(async () => {
              try {
                const result = await runAdminAction(
                  () =>
                    updateAdminUserAccessStatusAction({
                      userId: statusTarget.user.userId,
                      status: statusTarget.nextStatus,
                    }),
                  reauthenticate,
                  canMutate,
                );
                throwForActionFailure(result);
                setStatusTarget(null);
                router.refresh();
              } catch (error) {
                setStatusError(
                  error instanceof AdminClientError
                    ? error
                    : new AdminClientError("利用状態を更新できませんでした。"),
                );
              } finally {
                statusSubmitting.current = false;
              }
            });
          }}
        />
      )}
      <Dialog
        open={editingUser !== null}
        onOpenChange={(open) => {
          if (!open) closeDisplayNameEdit();
        }}
      >
        <DialogContent showCloseButton={!displayNamePending}>
          <DialogHeader>
            <DialogTitle>表示名を編集</DialogTitle>
          </DialogHeader>
          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="display-name"
          >
            表示名
            <Input
              id="display-name"
              aria-label="表示名"
              className="font-normal"
              type="text"
              value={displayNameInput}
              disabled={displayNamePending}
              onChange={(event) => {
                setDisplayNameInput(event.target.value);
                setDisplayNameValidationError(null);
              }}
            />
          </label>
          {displayNameValidationError && (
            <p className="text-sm text-red-700" role="alert">
              {displayNameValidationError}
            </p>
          )}
          {displayNameError && (
            <Alert variant="destructive">
              <AlertDescription>{displayNameError.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDisplayNameEdit}
              disabled={displayNamePending}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={saveDisplayName}
              disabled={displayNamePending || !editingUser}
            >
              {displayNamePending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserDetail({
  initialUsers,
  userId,
  currentMonth,
}: {
  initialUsers: AdminUserListState;
  userId: string;
  currentMonth: string;
}) {
  const { authState } = useAuth();

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
            {initialUsers.status === "ready" &&
              (() => {
                const user = initialUsers.data.find(
                  (candidate) => candidate.userId === userId,
                );
                if (!user) return <p>ユーザーが見つかりません。</p>;
                return (
                  <DetailContent
                    key={user.userId}
                    user={user}
                    currentUserId={authState.user.userId}
                    currentMonth={currentMonth}
                  />
                );
              })()}
          </>
        )}
      </section>
    </main>
  );
}

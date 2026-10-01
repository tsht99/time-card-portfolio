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
import { MAX_DISPLAY_NAME_CODE_POINTS } from "@repo/users";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, CirclePause, CirclePlay } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminUsersState } from "../../../../lib/admin-user-management-types";
import {
  updateAdminUserDisplayNameAction,
  updateAdminUserStatusAction,
} from "../../_actions/user-management-actions.ts";
import { useAuth } from "../../_components/auth-provider.tsx";
import { NavigationCard } from "../../_components/navigation-card.tsx";
import { UserContextCard } from "../../_components/user-context-card.tsx";
import {
  type AdminClientError,
  clientErrorFromAction,
  runAdminAction,
} from "../../_lib/admin-action-client.ts";

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
  const { reauthenticate } = useAuth();
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [displayNameValidationError, setDisplayNameValidationError] = useState<
    string | null
  >(null);

  const statusMutation = useMutation<void, AdminClientError, StatusTarget>({
    mutationFn: async ({ user: targetUser, nextStatus: targetStatus }) => {
      const result = await runAdminAction(
        () =>
          updateAdminUserStatusAction({
            userId: targetUser.userId,
            status: targetStatus,
          }),
        reauthenticate,
      );
      if (!result.success) throw clientErrorFromAction(result);
    },
    onSuccess: () => {
      setStatusTarget(null);
      router.refresh();
    },
  });

  const displayNameMutation = useMutation<
    void,
    AdminClientError,
    { userId: string; displayName: string }
  >({
    mutationFn: async ({ userId, displayName }) => {
      const result = await runAdminAction(
        () => updateAdminUserDisplayNameAction({ userId, displayName }),
        reauthenticate,
      );
      if (!result.success) throw clientErrorFromAction(result);
    },
    onSuccess: () => {
      setEditingUser(null);
      setDisplayNameInput("");
      setDisplayNameValidationError(null);
      router.refresh();
    },
  });

  const isMutationPending =
    statusMutation.isPending || displayNameMutation.isPending;
  const canEditDisplayName =
    user.role === "staff" ||
    (user.role === "admin" && user.userId === currentUserId);

  function requestStatusChange() {
    if (
      isMutationPending ||
      user.role !== "staff" ||
      (user.status !== "pending" &&
        user.status !== "active" &&
        user.status !== "inactive")
    )
      return;
    statusMutation.reset();
    setStatusTarget({ user, nextStatus: nextStatus(user.status) });
  }

  function startDisplayNameEdit() {
    if (!canEditDisplayName || isMutationPending) return;
    displayNameMutation.reset();
    setDisplayNameInput(user.displayName ?? "");
    setDisplayNameValidationError(null);
    setEditingUser(user);
  }

  function closeDisplayNameEdit() {
    if (displayNameMutation.isPending) return;
    setEditingUser(null);
    setDisplayNameInput("");
    setDisplayNameValidationError(null);
    displayNameMutation.reset();
  }

  function saveDisplayName() {
    if (!editingUser || displayNameMutation.isPending) return;
    const displayName = displayNameInput.trim();
    if (!displayName) {
      setDisplayNameValidationError("表示名を入力してください。");
      displayNameMutation.reset();
      return;
    }
    if (Array.from(displayName).length > MAX_DISPLAY_NAME_CODE_POINTS) {
      setDisplayNameValidationError("表示名は100文字以内で入力してください。");
      displayNameMutation.reset();
      return;
    }
    setDisplayNameValidationError(null);
    displayNameMutation.reset();
    displayNameMutation.mutate({ userId: editingUser.userId, displayName });
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
          href={`/admin/users/${encodeURIComponent(user.userId)}/hourly-wage-rates`}
        >
          時給設定
        </NavigationCard>
        <NavigationCard
          href={`/admin/users/${encodeURIComponent(user.userId)}/payroll?month=${currentMonth}`}
        >
          給与詳細
        </NavigationCard>
      </section>
      <Dialog
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open && !statusMutation.isPending) {
            setStatusTarget(null);
            statusMutation.reset();
          }
        }}
      >
        <DialogContent showCloseButton={!statusMutation.isPending}>
          <DialogHeader>
            <DialogTitle>
              {statusTarget
                ? statusDialogTitle(statusTarget.user.status)
                : "状態変更"}
            </DialogTitle>
          </DialogHeader>
          {statusTarget && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md bg-zinc-50 p-3 text-sm">
              <dt>対象スタッフ</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                {statusTarget.user.displayName ?? "名前未設定"}
              </dd>
              <dt>現在の状態</dt>
              <dd>{statusLabel(statusTarget.user.status)}</dd>
              <dt>変更後の状態</dt>
              <dd>{statusLabel(statusTarget.nextStatus)}</dd>
            </dl>
          )}
          {statusMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {statusMutation.error.message}
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStatusTarget(null)}
              disabled={statusMutation.isPending}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!statusTarget || statusMutation.isPending) return;
                statusMutation.mutate(statusTarget);
              }}
              disabled={statusMutation.isPending || !statusTarget}
            >
              {statusMutation.isPending ? "更新中" : operationLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editingUser !== null}
        onOpenChange={(open) => {
          if (!open) closeDisplayNameEdit();
        }}
      >
        <DialogContent showCloseButton={!displayNameMutation.isPending}>
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
              disabled={displayNameMutation.isPending}
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
          {displayNameMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {displayNameMutation.error.message}
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDisplayNameEdit}
              disabled={displayNameMutation.isPending}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={saveDisplayName}
              disabled={displayNameMutation.isPending || !editingUser}
            >
              {displayNameMutation.isPending ? "保存中..." : "保存"}
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
  initialUsers: AdminUsersState;
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

"use client";

import type {
  HourlyWageRateResource,
  UpdateHourlyWageRateRequest,
} from "@repo/payroll/contracts";
import { createHourlyWageRateRequestSchema } from "@repo/payroll/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import type { AdminUsersState } from "../../../../../../lib/admin-user-management-types";
import {
  deleteAdminHourlyWageRateAction,
  getAdminHourlyWageRatesAction,
  updateAdminHourlyWageRateAction,
} from "../../../../_actions/user-management-actions.ts";
import { useAuth } from "../../../../_components/auth-provider.tsx";
import { UserContextCard } from "../../../../_components/user-context-card.tsx";
import {
  clientErrorFromAction,
  clientErrorFromReadState,
  readAdminState,
  runAdminAction,
} from "../../../../_lib/admin-action-client.ts";

type Rate = HourlyWageRateResource;

const dayOrder: Rate["dayType"][] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
];
const dayLabels: Record<Rate["dayType"], string> = {
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土",
  sun: "日",
  holiday: "祝日",
};
const periods: Rate["workPeriod"][] = ["day", "night"];
const days: Rate["dayType"][] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
];

function japanToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function weekdayClass(dayType: Rate["dayType"]) {
  if (dayType === "sat") return "text-blue-700";
  if (dayType === "sun" || dayType === "holiday") return "text-red-700";
  return "";
}

function getChanges(rates: readonly Rate[]) {
  const ordered = [...rates].sort(
    (a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom) ||
      dayOrder.indexOf(a.dayType) - dayOrder.indexOf(b.dayType) ||
      (a.workPeriod === b.workPeriod ? 0 : a.workPeriod === "day" ? -1 : 1),
  );
  const previous = new Map<string, number>();
  const groups = new Map<
    string,
    Array<{ rate: Rate; previous: number | null }>
  >();
  for (const rate of ordered) {
    const key = `${rate.userId}\u0000${rate.dayType}\u0000${rate.workPeriod}`;
    const group = groups.get(rate.effectiveFrom) ?? [];
    group.push({ rate, previous: previous.get(key) ?? null });
    groups.set(rate.effectiveFrom, group);
    previous.set(key, rate.hourlyWage);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([effectiveFrom, changes]) => ({ effectiveFrom, changes }));
}

export function HourlyWageHistory({
  initialUsers,
  userId,
}: {
  initialUsers: AdminUsersState;
  userId: string;
}) {
  const { authState, reauthenticate } = useAuth();
  const queryClient = useQueryClient();
  const [editingRate, setEditingRate] = useState<Rate | null>(null);
  const [deletingRate, setDeletingRate] = useState<Rate | null>(null);
  const [draft, setDraft] = useState({
    workPeriod: "day" as Rate["workPeriod"],
    dayType: "mon" as Rate["dayType"],
    hourlyWage: "",
    effectiveFrom: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const updateSubmitting = useRef(false);
  const deleteSubmitting = useRef(false);
  const user =
    initialUsers.status === "ready"
      ? initialUsers.data.find((candidate) => candidate.userId === userId)
      : undefined;
  const ratesQuery = useQuery<Rate[], Error>({
    queryKey: ["hourly-wage-rates", userId],
    queryFn: async () => {
      const state = await readAdminState(
        () => getAdminHourlyWageRatesAction({ userId }),
        reauthenticate,
      );
      if (state.status !== "ready") throw clientErrorFromReadState(state);
      return state.data;
    },
    enabled: authState.status === "ready" && user !== undefined,
    retry: false,
  });
  const canEdit =
    authState.status === "ready" &&
    !!user &&
    (user.role === "staff" ||
      (user.role === "admin" && authState.user.userId === user.userId));
  const invalidateHistory = () =>
    queryClient.invalidateQueries({ queryKey: ["hourly-wage-rates", userId] });
  const updateMutation = useMutation({
    mutationFn: async ({
      rate,
      request,
    }: {
      rate: Rate;
      request: UpdateHourlyWageRateRequest;
    }) => {
      const result = await runAdminAction(
        () =>
          updateAdminHourlyWageRateAction({
            userId,
            hourlyWageRateId: rate.id,
            ...request,
          }),
        reauthenticate,
      );
      if (!result.success) throw clientErrorFromAction(result);
    },
    onSuccess: async () => {
      setEditingRate(null);
      setErrorMessage(null);
      setConflictMessage(null);
      await invalidateHistory();
    },
    onError: async (error: Error & { code?: string }) => {
      if (error.code === "HOURLY_WAGE_RATE_VERSION_CONFLICT") {
        setEditingRate(null);
        setErrorMessage(null);
        setConflictMessage(error.message);
        await invalidateHistory();
      } else setErrorMessage(error.message);
    },
    onSettled: () => {
      updateSubmitting.current = false;
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (rate: Rate) => {
      const result = await runAdminAction(
        () =>
          deleteAdminHourlyWageRateAction({
            userId,
            hourlyWageRateId: rate.id,
            expectedVersion: rate.version,
          }),
        reauthenticate,
      );
      if (!result.success) throw clientErrorFromAction(result);
    },
    onSuccess: async () => {
      setDeletingRate(null);
      setErrorMessage(null);
      setConflictMessage(null);
      await invalidateHistory();
    },
    onError: async (error: Error & { code?: string }) => {
      if (error.code === "HOURLY_WAGE_RATE_VERSION_CONFLICT") {
        setDeletingRate(null);
        setErrorMessage(null);
        setConflictMessage(error.message);
        await invalidateHistory();
      } else setErrorMessage(error.message);
    },
    onSettled: () => {
      deleteSubmitting.current = false;
    },
  });
  function beginEdit(rate: Rate) {
    setErrorMessage(null);
    setConflictMessage(null);
    updateMutation.reset();
    setDraft({
      workPeriod: rate.workPeriod,
      dayType: rate.dayType,
      hourlyWage: String(rate.hourlyWage),
      effectiveFrom: rate.effectiveFrom,
    });
    setEditingRate(rate);
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
            {ratesQuery.isPending && (
              <p className="mt-6 text-sm text-zinc-600" role="status">
                時給履歴を読み込み中
              </p>
            )}
            {ratesQuery.error && (
              <Alert variant="destructive" className="mt-6">
                <AlertDescription>{ratesQuery.error.message}</AlertDescription>
              </Alert>
            )}
            {!ratesQuery.isPending &&
              !ratesQuery.error &&
              ratesQuery.data &&
              (ratesQuery.data.length === 0 ? (
                <p className="mt-6 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
                  時給履歴はありません。
                </p>
              ) : (
                <HistorySections
                  groups={getChanges(ratesQuery.data)}
                  canEdit={canEdit}
                  onEdit={beginEdit}
                  onDelete={(rate) => {
                    setErrorMessage(null);
                    setConflictMessage(null);
                    deleteMutation.reset();
                    setDeletingRate(rate);
                  }}
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
      <Dialog
        open={editingRate !== null}
        onOpenChange={(open) => {
          if (!open && !updateMutation.isPending) {
            setEditingRate(null);
            setErrorMessage(null);
          }
        }}
      >
        <DialogContent showCloseButton={!updateMutation.isPending}>
          <DialogHeader>
            <DialogTitle>時給ルールを訂正</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !editingRate ||
                updateMutation.isPending ||
                updateSubmitting.current
              )
                return;
              if (draft.hourlyWage.trim() === "") {
                setErrorMessage("時給を入力してください。");
                return;
              }
              const parsed = createHourlyWageRateRequestSchema.safeParse({
                ...draft,
                hourlyWage: Number(draft.hourlyWage),
              });
              if (!parsed.success) {
                setErrorMessage("入力内容を確認してください。");
                return;
              }
              updateSubmitting.current = true;
              setErrorMessage(null);
              updateMutation.mutate({
                rate: editingRate,
                request: {
                  ...parsed.data,
                  expectedVersion: editingRate.version,
                },
              });
            }}
          >
            <div className="grid gap-1 text-sm">
              <span>勤務区分</span>
              <Select
                value={draft.workPeriod}
                onValueChange={(value) =>
                  value &&
                  setDraft({
                    ...draft,
                    workPeriod: value as Rate["workPeriod"],
                  })
                }
              >
                <SelectTrigger aria-label="勤務区分">
                  <SelectValue>
                    {draft.workPeriod === "day" ? "昼" : "夜"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {periods.map((period) => (
                    <SelectItem key={period} value={period}>
                      {period === "day" ? "昼" : "夜"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1 text-sm">
              <span>日区分</span>
              <Select
                value={draft.dayType}
                onValueChange={(value) =>
                  value &&
                  setDraft({
                    ...draft,
                    dayType: value as Rate["dayType"],
                  })
                }
              >
                <SelectTrigger aria-label="日区分">
                  <SelectValue>{dayLabels[draft.dayType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {days.map((day) => (
                    <SelectItem key={day} value={day}>
                      {dayLabels[day]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label htmlFor="edit-hourly-wage" className="grid gap-1 text-sm">
              時給
              <Input
                id="edit-hourly-wage"
                aria-label="時給"
                type="number"
                min="0"
                step="1"
                value={draft.hourlyWage}
                onChange={(e) =>
                  setDraft({ ...draft, hourlyWage: e.target.value })
                }
              />
            </label>
            <label htmlFor="edit-effective-from" className="grid gap-1 text-sm">
              適用開始日
              <Input
                id="edit-effective-from"
                aria-label="適用開始日"
                type="date"
                value={draft.effectiveFrom}
                onChange={(e) =>
                  setDraft({ ...draft, effectiveFrom: e.target.value })
                }
              />
            </label>
            {errorMessage && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={updateMutation.isPending}
                onClick={() => setEditingRate(null)}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "保存中" : "訂正する"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deletingRate !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeletingRate(null);
            setErrorMessage(null);
          }
        }}
      >
        <DialogContent showCloseButton={!deleteMutation.isPending}>
          <DialogHeader>
            <DialogTitle>時給ルールを削除</DialogTitle>
            <DialogDescription>
              このルールを削除すると、その期間は直前のルール、存在しなければ未設定が適用されます。
            </DialogDescription>
          </DialogHeader>
          {deletingRate && (
            <p className="text-sm">
              {deletingRate.effectiveFrom.replaceAll("-", "/")}・
              {dayLabels[deletingRate.dayType]}・
              {deletingRate.workPeriod === "day" ? "昼" : "夜"}・
              {deletingRate.hourlyWage.toLocaleString("ja-JP")}円
            </p>
          )}
          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleteMutation.isPending}
              onClick={() => setDeletingRate(null)}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending || !deletingRate}
              onClick={() => {
                if (
                  !deletingRate ||
                  deleteMutation.isPending ||
                  deleteSubmitting.current
                )
                  return;
                deleteSubmitting.current = true;
                deleteMutation.mutate(deletingRate);
              }}
            >
              {deleteMutation.isPending ? "削除中..." : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function HistorySections({
  groups,
  canEdit,
  onEdit,
  onDelete,
}: {
  groups: ReturnType<typeof getChanges>;
  canEdit: boolean;
  onEdit: (rate: Rate) => void;
  onDelete: (rate: Rate) => void;
}) {
  const today = japanToday();
  const future = groups.filter((group) => group.effectiveFrom > today);
  const past = groups.filter((group) => group.effectiveFrom <= today);
  return (
    <div className="mt-6 grid gap-8">
      {future.length > 0 && (
        <HistorySection
          title="適用予定"
          groups={future}
          canEdit={canEdit}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      {past.length > 0 && (
        <HistorySection
          title="過去の変更"
          groups={past}
          canEdit={canEdit}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function HistorySection({
  title,
  groups,
  canEdit,
  onEdit,
  onDelete,
}: {
  title: string;
  groups: ReturnType<typeof getChanges>;
  canEdit: boolean;
  onEdit: (rate: Rate) => void;
  onDelete: (rate: Rate) => void;
}) {
  return (
    <section aria-labelledby={`history-${title}`}>
      <h2 id={`history-${title}`} className="text-base font-semibold">
        {title}
      </h2>
      <div className="mt-3 grid gap-3">
        {groups.map(({ effectiveFrom, changes }) => (
          <article
            key={effectiveFrom}
            className="rounded-md border border-zinc-200 bg-white p-4"
          >
            <h3 className="font-semibold tabular-nums">
              {effectiveFrom.replaceAll("-", "/")}から
            </h3>
            <ul className="mt-3 grid gap-2">
              {changes.map(({ rate, previous }) => (
                <li
                  key={rate.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <span
                    className={`min-w-8 font-medium ${weekdayClass(rate.dayType)}`}
                  >
                    {dayLabels[rate.dayType]}
                  </span>
                  <WorkPeriodLabel workPeriod={rate.workPeriod} />
                  <span className="tabular-nums">
                    {previous === null
                      ? "未設定"
                      : `${previous.toLocaleString("ja-JP")}円`}{" "}
                    → {rate.hourlyWage.toLocaleString("ja-JP")}円
                  </span>
                  {canEdit && (
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="時給ルールを訂正"
                        title="時給ルールを訂正"
                        onClick={() => onEdit(rate)}
                        className="text-zinc-700"
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="時給ルールを削除"
                        title="時給ルールを削除"
                        onClick={() => onDelete(rate)}
                        className="text-red-700"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

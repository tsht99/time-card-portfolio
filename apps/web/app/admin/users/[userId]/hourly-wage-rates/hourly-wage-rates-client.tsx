"use client";

import type {
  BulkUpdateHourlyWageRatesRequest,
  HourlyWageRateResource,
} from "@repo/payroll/contracts";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, History, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import type { AdminUsersState } from "../../../../../lib/admin-user-management-types";
import {
  bulkUpdateAdminHourlyWageRatesAction,
  getAdminHourlyWageRatesAction,
} from "../../../_actions/user-management-actions.ts";
import { useAuth } from "../../../_components/auth-provider.tsx";
import { UserContextCard } from "../../../_components/user-context-card.tsx";
import {
  type AdminClientError,
  clientErrorFromAction,
  clientErrorFromReadState,
  readAdminState,
  runAdminAction,
} from "../../../_lib/admin-action-client.ts";

type HourlyWageRate = HourlyWageRateResource;

const queryKeys = {
  hourlyWageRates: (userId: string) => ["hourly-wage-rates", userId] as const,
};

const dayTypeLabels: Record<HourlyWageRate["dayType"], string> = {
  sun: "日",
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土",
  holiday: "祝日",
};

function getSortedRates(rates: HourlyWageRate[]) {
  return [...rates].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
}

function getJapanToday() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function parseBulkHourlyWageDraft(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const hourlyWage = Number(value);
  return Number.isSafeInteger(hourlyWage) && hourlyWage <= 99999
    ? hourlyWage
    : null;
}

const matrixDayTypes: HourlyWageRate["dayType"][] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
];

function findMatrixRate(
  rates: readonly HourlyWageRate[],
  userId: string,
  workPeriod: HourlyWageRate["workPeriod"],
  dayType: HourlyWageRate["dayType"],
  baselineDate: string,
) {
  return rates.reduce<HourlyWageRate | null>((selectedRate, rate) => {
    if (
      rate.userId !== userId ||
      rate.workPeriod !== workPeriod ||
      rate.dayType !== dayType ||
      rate.effectiveFrom > baselineDate
    ) {
      return selectedRate;
    }
    if (
      selectedRate === null ||
      rate.effectiveFrom > selectedRate.effectiveFrom
    ) {
      return rate;
    }
    return selectedRate;
  }, null);
}

function formatEffectiveFrom(effectiveFrom: string) {
  return `${effectiveFrom.replaceAll("-", "/")}から`;
}

function getAvailablePeriods(rates: readonly HourlyWageRate[], userId: string) {
  return [
    ...new Set(
      rates
        .filter((rate) => rate.userId === userId)
        .map((rate) => rate.effectiveFrom),
    ),
  ].sort((a, b) => b.localeCompare(a));
}

function dayTypeClassName(dayType: HourlyWageRate["dayType"]) {
  if (dayType === "sat") return "text-blue-700";
  if (dayType === "sun" || dayType === "holiday") return "text-red-700";
  return "";
}

function HourlyWageMatrix({
  rates,
  userId,
  baselineDate,
  editing = false,
  drafts,
  onDraftChange,
  disabled = false,
}: {
  rates: readonly HourlyWageRate[];
  userId: string;
  baselineDate: string;
  editing?: boolean;
  drafts?: Record<string, string>;
  onDraftChange?: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <table className="mt-3 w-full table-fixed border-collapse text-left text-xs">
      <caption className="sr-only">曜日別・昼夜別の時給</caption>
      <thead>
        <tr>
          <th scope="col" className="w-[22%] border-b border-zinc-300 p-2">
            <span className="sr-only">日区分</span>
          </th>
          <th scope="col" className="w-[39%] border-b border-zinc-300 p-2">
            <WorkPeriodLabel workPeriod="day" />
          </th>
          <th scope="col" className="w-[39%] border-b border-zinc-300 p-2">
            <WorkPeriodLabel workPeriod="night" />
          </th>
        </tr>
      </thead>
      <tbody>
        {matrixDayTypes.map((dayType) => (
          <tr key={dayType}>
            <th
              scope="row"
              className={`border-b border-zinc-200 p-2 align-top font-medium ${dayTypeClassName(dayType)}`}
            >
              {dayTypeLabels[dayType]}
            </th>
            {(["day", "night"] as const).map((workPeriod) => {
              const selectedRate = findMatrixRate(
                rates,
                userId,
                workPeriod,
                dayType,
                baselineDate,
              );
              const draftKey = `${dayType}:${workPeriod}`;
              const draftValue = drafts?.[draftKey] ?? "";
              const draftValueNumber = parseBulkHourlyWageDraft(draftValue);
              return (
                <td
                  key={workPeriod}
                  className="border-b border-zinc-200 p-2 align-top break-words"
                >
                  <span className="font-semibold tabular-nums">
                    {selectedRate
                      ? `${selectedRate.hourlyWage.toLocaleString("ja-JP")}円`
                      : "未設定"}
                  </span>
                  {editing && (
                    <div className="mt-2 flex items-center gap-1">
                      <CornerDownRight
                        aria-hidden="true"
                        className="size-3 shrink-0 text-zinc-500"
                      />
                      <Input
                        id={`bulk-wage-${dayType}-${workPeriod}`}
                        aria-label={`${dayTypeLabels[dayType]} ${workPeriod === "day" ? "昼" : "夜"}の変更時給`}
                        aria-invalid={
                          draftValue !== "" && draftValueNumber === null
                        }
                        aria-describedby={
                          draftValue !== "" && draftValueNumber === null
                            ? `bulk-wage-error-${dayType}-${workPeriod}`
                            : undefined
                        }
                        inputMode="numeric"
                        type="number"
                        disabled={disabled}
                        min={0}
                        max={99999}
                        step={1}
                        value={draftValue}
                        onChange={(event) =>
                          onDraftChange?.(draftKey, event.target.value)
                        }
                      />
                      {draftValue !== "" && draftValueNumber === null && (
                        <span
                          id={`bulk-wage-error-${dayType}-${workPeriod}`}
                          className="sr-only"
                        >
                          時給は0以上99,999以下の整数で入力してください。
                        </span>
                      )}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HourlyWageRatesClient({
  initialUsers,
  selectedUserId,
  initialReferenceDate,
}: {
  initialUsers: AdminUsersState;
  selectedUserId: string;
  initialReferenceDate?: string;
}) {
  const { authState, reauthenticate } = useAuth();
  const queryClient = useQueryClient();
  const [selectedPeriod, setSelectedPeriod] = useState(
    initialReferenceDate ?? "current",
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkDrafts, setBulkDrafts] = useState<Record<string, string>>({});
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const ratesQuery = useQuery<HourlyWageRate[], AdminClientError>({
    queryKey: queryKeys.hourlyWageRates(selectedUserId),
    queryFn: async () => {
      const state = await readAdminState(
        () => getAdminHourlyWageRatesAction({ userId: selectedUserId }),
        reauthenticate,
      );
      if (state.status !== "ready") throw clientErrorFromReadState(state);
      return state.data;
    },
    enabled: authState.status === "ready",
    retry: false,
  });
  const bulkMutation = useMutation<
    void,
    AdminClientError,
    { userId: string; request: BulkUpdateHourlyWageRatesRequest }
  >({
    mutationFn: async ({ userId, request }) => {
      const result = await runAdminAction(
        () => bulkUpdateAdminHourlyWageRatesAction({ userId, ...request }),
        reauthenticate,
      );
      if (!result.success) throw clientErrorFromAction(result);
    },
    onSuccess: (_data, vars) => {
      setSelectedPeriod(bulkDate);
      setBulkEditing(false);
      setBulkDrafts({});
      setSuccessMessage("時給を更新しました。");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.hourlyWageRates(vars.userId),
      });
    },
    onError: (error, vars) => {
      if (error.code === "HOURLY_WAGE_RATE_BULK_CONFLICT") {
        setBulkDrafts({});
        setConflictMessage(error.message);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.hourlyWageRates(vars.userId),
        });
      }
    },
  });
  const users = initialUsers.status === "ready" ? initialUsers.data : [];
  const selectedUser = users.find((user) => user.userId === selectedUserId);
  const canEditSelectedUser =
    authState.status === "ready" &&
    initialUsers.status === "ready" &&
    selectedUser !== undefined &&
    (selectedUser.role === "staff" ||
      (selectedUser.role === "admin" &&
        selectedUser.userId === authState.user.userId));

  const rates = ratesQuery.data ? getSortedRates(ratesQuery.data) : [];
  const baselineDate =
    selectedPeriod === "current" ? getJapanToday() : selectedPeriod;
  const availablePeriods = getAvailablePeriods(rates, selectedUserId);
  const contextualPeriodLabel = (date: string) =>
    `${date.replaceAll("-", "/")}時点`;
  const selectPeriods = availablePeriods.filter(
    (period) => period !== initialReferenceDate,
  );
  const hasInvalidBulkDraft = Object.values(bulkDrafts).some(
    (value) => value !== "" && parseBulkHourlyWageDraft(value) === null,
  );
  const bulkChanges = bulkEditing
    ? Object.entries(bulkDrafts).flatMap(([key, value]) => {
        if (value === "") return [];
        const [dayType, workPeriod] = key.split(":") as [
          HourlyWageRate["dayType"],
          HourlyWageRate["workPeriod"],
        ];
        const hourlyWage = parseBulkHourlyWageDraft(value);
        if (hourlyWage === null) return [];
        const baseline = findMatrixRate(
          rates,
          selectedUserId,
          workPeriod,
          dayType,
          bulkDate,
        );
        if (baseline?.hourlyWage === hourlyWage) return [];
        return [
          {
            dayType,
            workPeriod,
            hourlyWage,
            expectedBaseline: baseline
              ? { id: baseline.id, version: baseline.version }
              : null,
          },
        ];
      })
    : [];
  function beginBulkEdit() {
    if (
      bulkMutation.isPending ||
      !ratesQuery.isSuccess ||
      ratesQuery.isFetching
    )
      return;
    setBulkDate(baselineDate);
    setBulkDrafts({});
    setBulkEditing(true);
    bulkMutation.reset();
    setConflictMessage(null);
  }
  function requestBulkDate(date: string) {
    if (Object.values(bulkDrafts).some((value) => value !== ""))
      setPendingDate(date);
    else setBulkDate(date);
  }
  function saveBulk() {
    if (
      !canEditSelectedUser ||
      bulkMutation.isPending ||
      hasInvalidBulkDraft ||
      bulkChanges.length === 0
    )
      return;
    bulkMutation.mutate({
      userId: selectedUserId,
      request: { effectiveFrom: bulkDate, changes: bulkChanges },
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
              aria-labelledby="hourly-wage-matrix-heading"
              className="mt-6 min-w-0"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2
                    id="hourly-wage-matrix-heading"
                    className="text-base font-semibold"
                  >
                    時給一覧
                  </h2>
                </div>
                <div className="flex gap-2">
                  <Button
                    render={
                      <Link
                        href={`/admin/users/${encodeURIComponent(selectedUserId)}/hourly-wage-rates/history`}
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
                        !ratesQuery.isSuccess ||
                        ratesQuery.isFetching ||
                        bulkMutation.isPending
                      }
                      className="text-zinc-700"
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              {bulkEditing ? (
                <Input
                  aria-label="適用開始日"
                  type="date"
                  value={bulkDate}
                  disabled={bulkMutation.isPending}
                  onChange={(event) => requestBulkDate(event.target.value)}
                  className="mt-3 bg-white"
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
              {ratesQuery.isPending && (
                <p className="mt-4 text-sm text-zinc-600" role="status">
                  時給一覧を読み込み中
                </p>
              )}
              {ratesQuery.error && (
                <Alert
                  variant={
                    ratesQuery.error.kind === "session"
                      ? "warning"
                      : "destructive"
                  }
                  className="mt-4"
                >
                  <AlertDescription>
                    {ratesQuery.error.message}
                  </AlertDescription>
                </Alert>
              )}
              {!ratesQuery.isPending && !ratesQuery.error && (
                <div className="mt-3 rounded-md border border-zinc-200 bg-white">
                  <HourlyWageMatrix
                    rates={rates}
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
                    disabled={bulkMutation.isPending}
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
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={bulkMutation.isPending}
                  onClick={() => {
                    setBulkEditing(false);
                    setBulkDrafts({});
                    setPendingDate(null);
                    bulkMutation.reset();
                  }}
                >
                  キャンセル
                </Button>
                <Button
                  type="button"
                  disabled={
                    bulkMutation.isPending ||
                    hasInvalidBulkDraft ||
                    bulkChanges.length === 0
                  }
                  onClick={saveBulk}
                >
                  保存
                </Button>
                {bulkMutation.error && (
                  <Alert variant="destructive" className="w-full">
                    <AlertDescription>
                      {bulkMutation.error.message}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            {bulkEditing && hasInvalidBulkDraft && (
              <Alert variant="warning" className="mt-2">
                <AlertDescription>
                  時給は0以上99,999以下の整数で入力してください。
                </AlertDescription>
              </Alert>
            )}
            {pendingDate !== null && (
              <Dialog
                open
                onOpenChange={(open) => {
                  if (!open) setPendingDate(null);
                }}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>入力内容を破棄しますか？</DialogTitle>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPendingDate(null)}
                    >
                      キャンセル
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        setBulkDrafts({});
                        setBulkDate(pendingDate);
                        setPendingDate(null);
                      }}
                    >
                      破棄して変更
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </>
        )}
      </section>
    </main>
  );
}

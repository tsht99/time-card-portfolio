"use client";

import type { AttendanceListStatus } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { WorkPeriodChoice } from "@/app/_components/work-period-choice";
import {
  type AttendanceFilters,
  getDefaultAttendanceFilters,
  isValidAttendanceDateRange,
  serializeAttendanceFilters,
} from "../../../lib/admin-attendance-filters";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "down" | "up" }) {
  return (
    <svg
      aria-hidden="true"
      className="ml-auto size-5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d={direction === "down" ? "m6 9 6 6 6-6" : "m18 15-6-6-6 6"} />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function formatDate(value: string): string {
  return value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3");
}

function formatSummaryDate(value: string): string {
  return value.replace(/^(\d{4})-0?(\d{1,2})-0?(\d{1,2})$/, "$2/$3");
}

function getUserLabel(userId: string, initialUsers: AdminUsersState): string {
  if (userId === "") return "全員";
  if (initialUsers.status === "ready") {
    const user = initialUsers.data.find(
      (candidate) => candidate.userId === userId,
    );
    if (user?.displayName) return user.displayName;
  }
  return `ID: ${userId}`;
}

function getWorkPeriodLabel(
  workPeriod: AttendanceFilters["workPeriod"],
): string {
  return workPeriod === "" ? "すべて" : workPeriod === "day" ? "昼" : "夜";
}

function getStatusLabel(status: AttendanceFilters["status"]): string {
  if (status === "") return "すべて";
  if (status === "working") return "勤務中";
  if (status === "completed") return "退勤済み";
  return "取消済み";
}

function AppliedChip({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs leading-5 font-medium text-zinc-700">
      {children}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

export function AttendanceSearchForm({
  appliedFilters,
  initialUsers,
  isVisible = true,
}: {
  appliedFilters: AttendanceFilters;
  initialUsers: AdminUsersState;
  isVisible?: boolean;
}) {
  const router = useRouter();
  const panelId = useId();
  const summaryId = useId();
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<AttendanceFilters>(appliedFilters);
  const invalidRange = !isValidAttendanceDateRange(
    draft.startAttendanceDateInclusive,
    draft.endAttendanceDateInclusive,
  );
  const userLabel = getUserLabel(appliedFilters.userId, initialUsers);
  const periodLabel = getWorkPeriodLabel(appliedFilters.workPeriod);
  const statusLabel = getStatusLabel(appliedFilters.status);

  function openForm() {
    setDraft(appliedFilters);
    setIsOpen(true);
  }

  function closeForm() {
    setDraft(appliedFilters);
    setIsOpen(false);
    searchToggleRef.current?.focus();
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalidRange) return;
    const nextQuery = serializeAttendanceFilters(draft).toString();
    const currentQuery = serializeAttendanceFilters(appliedFilters).toString();
    setIsOpen(false);
    setDraft(appliedFilters);
    if (nextQuery !== currentQuery) {
      router.push(`/admin/attendance?${nextQuery}`);
    } else {
      searchToggleRef.current?.focus();
    }
  }

  return (
    <div
      hidden={!isVisible}
      className="mt-6 rounded-md border border-zinc-200 bg-white"
    >
      <Button
        ref={searchToggleRef}
        type="button"
        variant="ghost"
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-label={isOpen ? "検索条件を閉じる" : "検索条件を開く"}
        aria-describedby={summaryId}
        onClick={isOpen ? closeForm : openForm}
        className={`min-h-12 w-full min-w-0 gap-2 bg-white p-3 text-left ${isOpen ? "rounded-t-md" : "rounded-md"}`}
      >
        <span id={summaryId} className="sr-only">
          期間：{formatDate(appliedFilters.startAttendanceDateInclusive)} ～{" "}
          {formatDate(appliedFilters.endAttendanceDateInclusive)}。利用者：
          {userLabel}。勤務区分：{periodLabel}。状態：{statusLabel}
        </span>
        <span
          data-testid="applied-filter-summary"
          aria-hidden="true"
          className="flex min-w-0 flex-1 flex-wrap gap-2"
        >
          <AppliedChip
            label={`${formatSummaryDate(appliedFilters.startAttendanceDateInclusive)} ～ ${formatSummaryDate(appliedFilters.endAttendanceDateInclusive)}`}
          >
            <CalendarIcon />
          </AppliedChip>
          {appliedFilters.userId !== "" && <AppliedChip label={userLabel} />}
          {appliedFilters.workPeriod !== "" && (
            <AppliedChip label={periodLabel} />
          )}
          {appliedFilters.status !== "" && <AppliedChip label={statusLabel} />}
        </span>
        <ChevronIcon direction={isOpen ? "up" : "down"} />
      </Button>
      <div
        id={panelId}
        hidden={!isOpen}
        className="border-t border-zinc-200 px-3 pt-4 pb-3"
      >
        {isOpen && (
          <>
            <form className="grid grid-cols-1 gap-3" onSubmit={search}>
              <fieldset className="min-w-0">
                <legend className="text-sm font-medium">期間</legend>
                <div className="mt-1 grid min-w-0 grid-cols-1 items-center rounded-md border border-input bg-white focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 min-[360px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[360px]:gap-1">
                  <label
                    htmlFor="attendance-search-from"
                    className="block min-w-0"
                  >
                    <Input
                      id="attendance-search-from"
                      type="date"
                      aria-label="開始日"
                      aria-invalid={invalidRange || undefined}
                      aria-describedby={
                        invalidRange
                          ? "attendance-search-range-error"
                          : undefined
                      }
                      value={draft.startAttendanceDateInclusive}
                      max={draft.endAttendanceDateInclusive}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          startAttendanceDateInclusive: event.target.value,
                        })
                      }
                      className="h-11 w-full min-w-0 rounded-none border-0 bg-transparent px-2 text-sm font-normal shadow-none focus-visible:border-0 focus-visible:ring-0 min-[360px]:px-1.5 min-[390px]:px-2"
                    />
                  </label>
                  <span
                    className="block text-center text-sm font-medium min-[360px]:inline"
                    aria-hidden="true"
                  >
                    〜
                  </span>
                  <label
                    htmlFor="attendance-search-to"
                    className="block min-w-0"
                  >
                    <Input
                      id="attendance-search-to"
                      type="date"
                      aria-label="終了日"
                      aria-invalid={invalidRange || undefined}
                      aria-describedby={
                        invalidRange
                          ? "attendance-search-range-error"
                          : undefined
                      }
                      value={draft.endAttendanceDateInclusive}
                      min={draft.startAttendanceDateInclusive}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          endAttendanceDateInclusive: event.target.value,
                        })
                      }
                      className="h-11 w-full min-w-0 rounded-none border-0 bg-transparent px-2 text-sm font-normal shadow-none focus-visible:border-0 focus-visible:ring-0 min-[360px]:px-1.5 min-[390px]:px-2"
                    />
                  </label>
                </div>
              </fieldset>
              <div className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                <label htmlFor="attendance-search-user">利用者</label>
                <Select
                  value={draft.userId === "" ? null : draft.userId}
                  onValueChange={(value) =>
                    setDraft({ ...draft, userId: value ?? "" })
                  }
                  disabled={initialUsers.status !== "ready"}
                >
                  <SelectTrigger
                    id="attendance-search-user"
                    aria-label="利用者"
                    className="bg-white font-normal"
                  >
                    <SelectValue className="min-w-0 flex-1">
                      {(value: string | null) =>
                        getUserLabel(value ?? "", initialUsers)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>全員</SelectItem>
                    {initialUsers.status === "ready" &&
                      initialUsers.data.map((user) => (
                        <SelectItem key={user.userId} value={user.userId}>
                          {user.displayName ?? `ID: ${user.userId}`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <WorkPeriodChoice
                value={draft.workPeriod}
                onValueChange={(workPeriod) =>
                  setDraft({ ...draft, workPeriod })
                }
                showAll
                legend="勤務区分"
                name="attendance-search-work-period"
              />
              <div className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                <label htmlFor="attendance-search-status">状態</label>
                <Select
                  value={draft.status === "" ? null : draft.status}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      status: value
                        ? (value as AttendanceListStatus | "cancelled")
                        : "",
                    })
                  }
                >
                  <SelectTrigger
                    id="attendance-search-status"
                    aria-label="状態"
                    className="bg-white font-normal"
                  >
                    <SelectValue className="min-w-0 flex-1">
                      {(value: string | null) =>
                        getStatusLabel(
                          (value ?? "") as AttendanceFilters["status"],
                        )
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>すべて</SelectItem>
                    <SelectItem value="working">勤務中</SelectItem>
                    <SelectItem value="completed">退勤済み</SelectItem>
                    <SelectItem value="cancelled">取消済み</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 self-start px-2 text-sm font-normal text-foreground"
                  onClick={() => setDraft(getDefaultAttendanceFilters())}
                >
                  <ResetIcon />
                  初期条件に戻す
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={closeForm}>
                  キャンセル
                </Button>
                <Button type="submit" disabled={invalidRange}>
                  検索
                </Button>
              </div>
            </form>
            {invalidRange && (
              <Alert
                id="attendance-search-range-error"
                variant="warning"
                className="mt-3"
              >
                <AlertDescription>
                  開始日は終了日以前の日付を指定してください。
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </div>
    </div>
  );
}

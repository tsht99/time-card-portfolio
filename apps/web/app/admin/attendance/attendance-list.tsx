"use client";

import type {
  AttendanceListItem,
  CancelledAttendanceListItem,
} from "@repo/contracts";
import { Plus } from "lucide-react";
import Link from "next/link";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import { formatStaffClockOutTime } from "../../../lib/staff-date-time";
import {
  NavigationList,
  NavigationListItem,
} from "../_components/navigation-list.tsx";
import {
  formatAttendanceDate,
  formatAttendanceTime,
} from "./attendance-format";
import { getAttendanceDetailHref } from "./attendance-navigation";

type AttendanceListEntry =
  | { kind: "active"; item: AttendanceListItem }
  | { kind: "cancelled"; item: CancelledAttendanceListItem };

type AttendanceDateGroup = {
  date: string;
  entries: AttendanceListEntry[];
};

function compareStrings(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareAttendanceEntries(
  left: AttendanceListEntry,
  right: AttendanceListEntry,
) {
  const leftItem = left.item;
  const rightItem = right.item;
  return (
    compareStrings(leftItem.attendanceDate, rightItem.attendanceDate) ||
    Date.parse(rightItem.clockInAt) - Date.parse(leftItem.clockInAt) ||
    compareStrings(leftItem.attendanceId, rightItem.attendanceId)
  );
}

function groupAttendanceEntries(entries: AttendanceListEntry[]) {
  const groups: AttendanceDateGroup[] = [];
  for (const entry of entries) {
    const date = entry.item.attendanceDate;
    const group = groups.at(-1);
    if (group?.date === date) {
      group.entries.push(entry);
    } else {
      groups.push({ date, entries: [entry] });
    }
  }
  return groups;
}

function getWorkPeriodLabel(
  workPeriod: AttendanceListEntry["item"]["workPeriod"],
) {
  return workPeriod === "day" ? "昼" : "夜";
}

function getAttendanceTimeLabel(entry: AttendanceListEntry) {
  if (entry.kind === "cancelled") {
    return "取消済み";
  }
  const clockInTime = formatAttendanceTime(entry.item.clockInAt);
  if (!entry.item.clockOutAt) {
    return `${clockInTime} - 勤務中`;
  }
  return `${clockInTime} - ${formatStaffClockOutTime(
    entry.item.clockOutAt,
    entry.item.attendanceDate,
  )}`;
}

function getAttendanceLinkLabel(entry: AttendanceListEntry) {
  const item = entry.item;
  const displayName = item.displayName ?? "名前未設定";
  return `${formatAttendanceDate(item.attendanceDate)} ${displayName} ${getWorkPeriodLabel(
    item.workPeriod,
  )} ${getAttendanceTimeLabel(entry)} 勤怠詳細へ移動`;
}

export function AttendanceList({
  attendance,
  cancelledAttendance,
  canonicalQuery,
}: {
  attendance: AttendanceListItem[];
  cancelledAttendance: CancelledAttendanceListItem[];
  canonicalQuery: string;
}) {
  const entries = [
    ...attendance.map<AttendanceListEntry>((item) => ({
      kind: "active",
      item,
    })),
    ...cancelledAttendance.map<AttendanceListEntry>((item) => ({
      kind: "cancelled",
      item,
    })),
  ].sort(compareAttendanceEntries);
  const dateGroups = groupAttendanceEntries(entries);
  const creationLink = (
    <div className="mt-4 flex justify-center">
      <Link
        href="/admin/attendance/new"
        aria-label="勤怠を新規作成"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
      >
        <Plus aria-hidden="true" className="size-5" />
      </Link>
    </div>
  );

  if (entries.length === 0) {
    return (
      <section className="mt-6" aria-label="勤怠一覧">
        <p className="mt-3 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
          この期間の勤怠はありません。
        </p>
        {creationLink}
      </section>
    );
  }

  return (
    <section className="mt-6" aria-label="勤怠一覧">
      <ul aria-label="勤怠一覧" className="mt-3 min-w-0 space-y-4">
        {dateGroups.map((group) => {
          const headingId = `attendance-date-${group.date}`;
          return (
            <li key={group.date} className="min-w-0">
              <h2
                id={headingId}
                className="text-sm font-semibold tabular-nums text-zinc-700"
              >
                {formatAttendanceDate(group.date)}
              </h2>
              <NavigationList aria-labelledby={headingId} className="mt-1">
                {group.entries.map((entry) => {
                  const item = entry.item;
                  const entryKey = `${entry.kind}-${item.attendanceId}`;
                  const displayName = item.displayName ?? "名前未設定";
                  return (
                    <NavigationListItem
                      key={entryKey}
                      href={getAttendanceDetailHref(
                        item.attendanceId,
                        canonicalQuery,
                      )}
                      aria-label={getAttendanceLinkLabel(entry)}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-1.5 px-2.5 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-base font-medium">
                        {displayName}
                      </span>
                      <WorkPeriodLabel workPeriod={item.workPeriod} />
                      <span
                        data-attendance-time-cell
                        className="grid min-w-0 grid-cols-[5ch_1ch_5ch] gap-x-1 leading-tight tabular-nums text-zinc-700"
                      >
                        {entry.kind === "cancelled" ? (
                          <span className="col-span-3 text-right">
                            取消済み
                          </span>
                        ) : (
                          <>
                            <span
                              data-attendance-time-part="clock-in"
                              className="text-right"
                            >
                              {formatAttendanceTime(item.clockInAt)}
                            </span>
                            <span
                              data-attendance-time-part="separator"
                              className="text-center"
                            >
                              -
                            </span>
                            <span
                              data-attendance-time-part="clock-out"
                              className="text-left"
                            >
                              {entry.item.clockOutAt
                                ? formatStaffClockOutTime(
                                    entry.item.clockOutAt,
                                    item.attendanceDate,
                                  )
                                : null}
                            </span>
                          </>
                        )}
                      </span>
                    </NavigationListItem>
                  );
                })}
              </NavigationList>
            </li>
          );
        })}
      </ul>
      {creationLink}
    </section>
  );
}

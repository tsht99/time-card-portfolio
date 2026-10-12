"use client";

import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { useCallback, useState, useTransition } from "react";
import { monthParser } from "../../../lib/month-query-state";
import type {
  StaffAttendanceHistory,
  StaffAttendanceHistoryReadState,
} from "../_lib/staff-attendance-types";

type StaffAttendanceHistoryResource =
  | { status: "ready"; data: StaffAttendanceHistory }
  | { status: "stale"; data: StaffAttendanceHistory; message: string }
  | { status: "unavailable"; message: string }
  | { status: "idle" };

export function useStaffAttendanceHistory({
  initialAttendanceHistory,
  selectedMonth,
}: {
  initialAttendanceHistory: StaffAttendanceHistoryReadState | null;
  selectedMonth: string;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [, setMonthQuery] = useQueryState(
    "month",
    monthParser.withOptions({
      history: "replace",
      shallow: false,
      scroll: false,
      startTransition,
    }),
  );
  const historyFromServer =
    initialAttendanceHistory?.status === "ready"
      ? initialAttendanceHistory.data
      : null;
  const [lastHistorySnapshot, setLastHistorySnapshot] = useState<{
    month: string;
    data: StaffAttendanceHistory;
  } | null>(() =>
    historyFromServer
      ? { month: selectedMonth, data: historyFromServer }
      : null,
  );

  const historySnapshot =
    historyFromServer ??
    (lastHistorySnapshot?.month === selectedMonth
      ? lastHistorySnapshot.data
      : null);
  const historyReadState: StaffAttendanceHistoryResource =
    initialAttendanceHistory === null
      ? { status: "idle" }
      : historyFromServer
        ? { status: "ready", data: historyFromServer }
        : lastHistorySnapshot?.month === selectedMonth
          ? {
              status: "stale",
              data: lastHistorySnapshot.data,
              message:
                initialAttendanceHistory.status === "error"
                  ? initialAttendanceHistory.message
                  : "勤怠履歴を取得できませんでした。",
            }
          : {
              status: "unavailable",
              message:
                initialAttendanceHistory.status === "error"
                  ? initialAttendanceHistory.message
                  : "勤怠履歴を取得できませんでした。",
            };

  const rememberHistorySnapshot = useCallback(() => {
    if (historySnapshot) {
      setLastHistorySnapshot({ month: selectedMonth, data: historySnapshot });
    }
  }, [historySnapshot, selectedMonth]);

  const refreshServer = useCallback(() => {
    rememberHistorySnapshot();
    startTransition(() => router.refresh());
  }, [rememberHistorySnapshot, router]);

  const navigateMonth = useCallback(
    (targetMonth: string) => {
      void setMonthQuery(targetMonth);
    },
    [setMonthQuery],
  );

  return {
    historySnapshot,
    historyReadState,
    isRefreshing,
    rememberHistorySnapshot,
    refreshServer,
    navigateMonth,
  };
}

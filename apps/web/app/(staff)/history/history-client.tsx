"use client";

import { useMemo } from "react";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { mergeMonthlyAttendance } from "../../../lib/monthly-attendance-view-model";
import type { StaffAttendanceHistoryReadState } from "../../../lib/staff-attendance-types";
import { StaffAuthStatus } from "../_components/staff-auth-status.tsx";
import { useStaffAttendanceHistory } from "../_hooks/use-staff-attendance-history.ts";
import { useStaffAuth } from "../_hooks/use-staff-auth.ts";
import { StaffHistoryView } from "./staff-history-view.tsx";

export function HistoryClient({
  initialAuth,
  selectedMonth,
  initialAttendanceHistory,
}: {
  initialAuth: AuthBootstrapState;
  selectedMonth: string;
  initialAttendanceHistory: StaffAttendanceHistoryReadState | null;
}) {
  const historyAttendance = useStaffAttendanceHistory({
    initialAttendanceHistory,
    selectedMonth,
    pathname: "/history",
  });
  const { authStatus, authMessage } = useStaffAuth({
    initialAuth,
    onAuthenticated: historyAttendance.refreshServer,
  });
  const {
    historySnapshot,
    historyReadState,
    isRefreshing,
    refreshServer,
    navigateMonth,
  } = historyAttendance;

  const attendanceHistory = useMemo(
    () => mergeMonthlyAttendance(historySnapshot ?? [], null, selectedMonth),
    [historySnapshot, selectedMonth],
  );
  const historyError =
    historyReadState.status === "ready" || historyReadState.status === "idle"
      ? null
      : historyReadState.message;

  if (authStatus !== "ready") {
    return (
      <StaffAuthStatus
        active="history"
        status={authStatus}
        message={authMessage}
      />
    );
  }

  return (
    <StaffHistoryView
      attendanceHistory={attendanceHistory}
      selectedMonth={selectedMonth}
      historyError={historyError}
      hasHistorySnapshot={historySnapshot !== null}
      isRefreshing={isRefreshing}
      onMonthChange={navigateMonth}
      onRetry={refreshServer}
    />
  );
}

"use client";

import type { CreateAttendanceEventRequest, WorkPeriod } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { deriveAttendanceViewModel } from "../../../lib/attendance-view-model";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import type { StaffCurrentAttendanceReadState } from "../../../lib/staff-attendance-types";
import {
  getCurrentTime,
  getMillisecondsUntilNextTokyoMidnight,
} from "../../../lib/staff-date-time";
import { clockStaffAttendanceAction } from "../_actions/attendance-actions.ts";
import { useStaffAuth } from "../_hooks/use-staff-auth.ts";
import { useStaffCurrentAttendance } from "../_hooks/use-staff-current-attendance.ts";
import {
  AttendanceActionError,
  executeStaffAttendanceAction,
  resolveStaffAttendanceErrorMessage,
} from "../_lib/staff-attendance-action.ts";
import { StaffAuthStatus } from "./staff-auth-status.tsx";
import { StaffClockView } from "./staff-clock-view.tsx";

export function StaffPage({
  initialAuth,
  initialCurrentAttendance = null,
}: {
  initialAuth: AuthBootstrapState;
  initialCurrentAttendance?: StaffCurrentAttendanceReadState | null;
}) {
  const initialTime = useMemo(() => getCurrentTime(), []);
  const [isHydrated, setIsHydrated] = useState(false);
  const [time, setTime] = useState(initialTime);
  const currentAttendance = useStaffCurrentAttendance({
    initialCurrentAttendance,
  });
  const {
    currentSnapshot,
    currentReadState,
    isRefreshing: isCurrentRefreshing,
    refreshServer: refreshCurrentAttendance,
  } = currentAttendance;
  const refreshServer = refreshCurrentAttendance;

  const { authStatus, authMessage, reauthenticate } = useStaffAuth({
    initialAuth,
    onAuthenticated: refreshServer,
  });

  const attendanceMutation = useMutation<
    void,
    Error,
    CreateAttendanceEventRequest
  >({
    mutationFn: (input) =>
      executeStaffAttendanceAction(
        clockStaffAttendanceAction,
        input,
        reauthenticate,
      ),
    onSuccess: () => {
      setTime(getCurrentTime());
      refreshServer();
    },
    onError: (error) => {
      if (
        error instanceof AttendanceActionError &&
        error.code === "ATTENDANCE_CLOCK_STALE"
      ) {
        refreshServer();
      }
    },
  });
  useEffect(() => {
    // Hydration must remain false for the initial client render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNextDateBoundary = () => {
      const now = new Date();
      timer = setTimeout(() => {
        setTime(getCurrentTime());
        refreshServer();
        scheduleNextDateBoundary();
      }, getMillisecondsUntilNextTokyoMidnight(now));
    };
    scheduleNextDateBoundary();
    return () => clearTimeout(timer);
  }, [refreshServer]);

  const attendanceViewModel = useMemo(
    () =>
      currentSnapshot
        ? deriveAttendanceViewModel(currentSnapshot.attendances)
        : null,
    [currentSnapshot],
  );
  const currentError =
    currentReadState.status === "ready" || currentReadState.status === "idle"
      ? null
      : currentReadState.message;
  const hasCurrentSnapshot = currentSnapshot !== null;
  const mainActionBusy =
    attendanceMutation.isPending ||
    isCurrentRefreshing ||
    !isHydrated ||
    !hasCurrentSnapshot ||
    currentReadState.status !== "ready";

  function recordQuickAction(
    period: WorkPeriod,
    type: "clock_in" | "clock_out",
  ) {
    if (mainActionBusy || !attendanceViewModel) return;
    if (attendanceViewModel.clockState === "ambiguous") return;
    if (type === "clock_in" && !attendanceViewModel.canStart[period]) return;
    const target = attendanceViewModel.clockOutTarget;
    if (
      type === "clock_out" &&
      (!target ||
        !attendanceViewModel.availableEventTypes[target.workPeriod].includes(
          "clock_out",
        ))
    )
      return;
    if (type === "clock_out") {
      if (!target) return;
      attendanceMutation.mutate({
        workPeriod: target.workPeriod,
        eventType: type,
        time,
        targetAttendanceId: target.attendanceId,
        targetEventVersion: target.eventVersion,
      });
      return;
    }
    attendanceMutation.mutate({
      workPeriod: period,
      eventType: type,
      time,
    });
  }

  const actionErrorMessage =
    resolveStaffAttendanceErrorMessage(
      attendanceMutation.error ?? null,
      attendanceMutation.variables?.eventType,
    ) ??
    (currentError
      ? hasCurrentSnapshot
        ? "最新の勤務状態を取得できませんでした。"
        : currentError
      : null);
  let actionStatusLabel = "確認中";
  if (
    (!hasCurrentSnapshot && currentError) ||
    attendanceViewModel?.clockState === "ambiguous"
  ) {
    actionStatusLabel = "エラー";
  } else if (attendanceViewModel) {
    actionStatusLabel =
      attendanceViewModel.clockState === "working_day"
        ? "昼勤務中"
        : attendanceViewModel.clockState === "working_night"
          ? "夜勤務中"
          : "未勤務";
  }
  const todayAttendances =
    currentReadState.status === "ready"
      ? currentReadState.data.attendances.filter(
          (attendance) =>
            attendance.attendanceDate === currentReadState.data.referenceDate,
        )
      : null;

  if (authStatus !== "ready") {
    return (
      <StaffAuthStatus
        active="clock"
        status={authStatus}
        message={authMessage}
      />
    );
  }

  return (
    <StaffClockView
      statusLabel={actionStatusLabel}
      isError={actionStatusLabel === "エラー"}
      clockState={
        attendanceViewModel?.clockState === "not_working" ||
        attendanceViewModel?.clockState === "working_day" ||
        attendanceViewModel?.clockState === "working_night"
          ? attendanceViewModel.clockState
          : null
      }
      canStart={attendanceViewModel?.canStart ?? { day: false, night: false }}
      time={time}
      busy={mainActionBusy}
      pendingOperation={
        attendanceMutation.isPending
          ? (attendanceMutation.variables?.eventType ?? null)
          : null
      }
      pendingWorkPeriod={
        attendanceMutation.isPending
          ? (attendanceMutation.variables?.workPeriod ?? null)
          : null
      }
      errorMessage={actionErrorMessage}
      onRetry={authStatus === "ready" && currentError ? refreshServer : null}
      onTimeChange={setTime}
      onClockIn={(period) => recordQuickAction(period, "clock_in")}
      onClockOut={() =>
        recordQuickAction(
          attendanceViewModel?.clockOutTarget?.workPeriod ?? "day",
          "clock_out",
        )
      }
      todayAttendances={todayAttendances}
    />
  );
}

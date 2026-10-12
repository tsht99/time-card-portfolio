"use client";

import type { CreateAttendanceEventRequest, WorkPeriod } from "@repo/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { clockStaffAttendanceAction } from "../_actions/attendance-actions.ts";
import { useStaffAuth } from "../_hooks/use-staff-auth.ts";
import { useStaffCurrentAttendance } from "../_hooks/use-staff-current-attendance.ts";
import { deriveAttendanceViewModel } from "../_lib/attendance-view-model";
import {
  AttendanceActionError,
  executeStaffAttendanceAction,
} from "../_lib/staff-attendance-action.ts";
import type { StaffCurrentAttendanceReadState } from "../_lib/staff-attendance-types";
import {
  getCurrentStaffDateTime,
  getMillisecondsUntilNextTokyoMidnight,
  toOccurredAt,
} from "../_lib/staff-date-time";
import { StaffAuthStatus } from "./staff-auth-status.tsx";
import { StaffClockView } from "./staff-clock-view.tsx";

export function StaffPage({
  initialAuth,
  initialCurrentAttendance = null,
}: {
  initialAuth: AuthBootstrapState;
  initialCurrentAttendance?: StaffCurrentAttendanceReadState | null;
}) {
  const initialDateTime = useMemo(() => getCurrentStaffDateTime(), []);
  const [dateTime, setDateTime] = useState(initialDateTime);
  const [isHydrated, setIsHydrated] = useState(false);
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
  const [attendancePending, setAttendancePending] = useState(false);
  const [attendanceError, setAttendanceError] = useState<Error | null>(null);
  const [pendingEventType, setPendingEventType] = useState<
    CreateAttendanceEventRequest["eventType"] | null
  >(null);
  const [pendingWorkPeriod, setPendingWorkPeriod] = useState<WorkPeriod | null>(
    null,
  );
  const attendanceInFlight = useRef(false);

  async function submitAttendance(input: CreateAttendanceEventRequest) {
    if (initialAuth.status !== "ready") return;
    if (attendanceInFlight.current) return;
    attendanceInFlight.current = true;
    setAttendancePending(true);
    setAttendanceError(null);
    setPendingEventType(input.eventType);
    setPendingWorkPeriod(input.workPeriod);
    try {
      const result = await executeStaffAttendanceAction(
        clockStaffAttendanceAction,
        input,
        reauthenticate,
        initialAuth.user.userId,
      );
      if (result.validationErrors !== undefined) {
        setAttendanceError(new Error("リクエスト形式が正しくありません。"));
        return;
      }
      if (result.serverError !== undefined) {
        const { code } = result.serverError;
        const displayMessage = getAttendanceErrorMessage(code, input.eventType);
        setAttendanceError(new AttendanceActionError(displayMessage, code));
        if (code === "ATTENDANCE_CLOCK_STALE" || code === "SESSION_EXPIRED")
          refreshServer();
        return;
      }
      setDateTime(getCurrentStaffDateTime());
      refreshServer();
    } catch (error) {
      const actionError = error instanceof AttendanceActionError ? error : null;
      const isKnownStaleError = actionError?.code === "ATTENDANCE_CLOCK_STALE";
      setAttendanceError(
        new AttendanceActionError(
          isKnownStaleError
            ? getAttendanceErrorMessage(
                "ATTENDANCE_CLOCK_STALE",
                input.eventType,
              )
            : getAttendanceErrorMessage("UNEXPECTED", input.eventType),
          actionError?.code,
        ),
      );
      if (isKnownStaleError) refreshServer();
    } finally {
      attendanceInFlight.current = false;
      setAttendancePending(false);
    }
  }

  function getAttendanceErrorMessage(
    code: string,
    eventType: CreateAttendanceEventRequest["eventType"],
  ) {
    switch (code) {
      case "SESSION_EXPIRED":
        return "ログイン状態を更新しました。元の打刻は記録されていません。最新の勤務状態を確認してから、もう一度操作してください。";
      case "ATTENDANCE_TIME_OVERLAP":
        return eventType === "clock_out"
          ? "既存の勤怠と勤務時間が重複しているため、退勤を記録できません。管理者に勤怠の確認を依頼してください。管理者による時刻の訂正、または誤って登録された勤怠の取消が必要な場合があります。"
          : "既存の勤怠と勤務時間が重複しています。出勤時刻を確認してください。";
      case "ATTENDANCE_PROCESSING_DATE_MISMATCH":
        return "打刻日がサーバー上の日付と一致しません。画面を再読み込みして最新の日付を確認してから、もう一度操作してください。";
      case "ATTENDANCE_CLOCK_STALE":
        return "勤怠の状態が更新されています。最新の状態を確認してから、もう一度操作してください。";
      case "ATTENDANCE_ALREADY_WORKING":
        return "退勤していない勤務があります。先に退勤してください。";
      default:
        return "打刻を完了できませんでした。通信状態を確認して、最新の勤務状態を再取得してください。";
    }
  }
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
    attendancePending ||
    isCurrentRefreshing ||
    !isHydrated ||
    !hasCurrentSnapshot ||
    currentReadState.status !== "ready";

  function recordQuickAction(
    period: WorkPeriod,
    type: "clock_in" | "clock_out",
  ) {
    if (mainActionBusy || !attendanceViewModel) return;
    if (attendanceViewModel.workStatus === "ambiguous") return;
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
      void submitAttendance({
        workPeriod: target.workPeriod,
        eventType: type,
        occurredAt: toOccurredAt(dateTime.date, dateTime.time),
        targetAttendanceId: target.attendanceId,
        targetEventVersion: target.eventVersion,
      });
      return;
    }
    void submitAttendance({
      workPeriod: period,
      eventType: type,
      occurredAt: toOccurredAt(dateTime.date, dateTime.time),
    });
  }

  const actionErrorMessage =
    attendanceError?.message ??
    (currentError
      ? hasCurrentSnapshot
        ? "最新の勤務状態を取得できませんでした。"
        : currentError
      : null);
  let actionStatusLabel = "確認中";
  if (
    (!hasCurrentSnapshot && currentError) ||
    attendanceViewModel?.workStatus === "ambiguous"
  ) {
    actionStatusLabel = "エラー";
  } else if (attendanceViewModel) {
    actionStatusLabel =
      attendanceViewModel.workStatus === "working_day"
        ? "昼勤務中"
        : attendanceViewModel.workStatus === "working_night"
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
      workStatus={
        attendanceViewModel?.workStatus === "not_working" ||
        attendanceViewModel?.workStatus === "working_day" ||
        attendanceViewModel?.workStatus === "working_night"
          ? attendanceViewModel.workStatus
          : null
      }
      canStart={attendanceViewModel?.canStart ?? { day: false, night: false }}
      date={dateTime.date}
      time={dateTime.time}
      busy={mainActionBusy}
      pendingOperation={attendancePending ? pendingEventType : null}
      pendingWorkPeriod={attendancePending ? pendingWorkPeriod : null}
      errorMessage={actionErrorMessage}
      onRetry={authStatus === "ready" && currentError ? refreshServer : null}
      onTimeChange={(value) =>
        setDateTime((current) => ({ ...current, time: value }))
      }
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

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import type {
  StaffCurrentAttendance,
  StaffCurrentAttendanceReadState,
} from "../../../lib/staff-attendance-types";

type StaffCurrentAttendanceResource =
  | { status: "ready"; data: StaffCurrentAttendance }
  | { status: "stale"; data: StaffCurrentAttendance; message: string }
  | { status: "unavailable"; message: string }
  | { status: "idle" };

export function useStaffCurrentAttendance({
  initialCurrentAttendance,
}: {
  initialCurrentAttendance: StaffCurrentAttendanceReadState | null;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const currentFromServer =
    initialCurrentAttendance?.status === "ready"
      ? initialCurrentAttendance.data
      : null;
  const [lastCurrentSnapshot, setLastCurrentSnapshot] =
    useState<StaffCurrentAttendance | null>(currentFromServer);

  const currentSnapshot = currentFromServer ?? lastCurrentSnapshot;
  const currentReadState: StaffCurrentAttendanceResource =
    initialCurrentAttendance === null
      ? { status: "idle" }
      : currentFromServer
        ? { status: "ready", data: currentFromServer }
        : lastCurrentSnapshot
          ? {
              status: "stale",
              data: lastCurrentSnapshot,
              message:
                initialCurrentAttendance.status === "error"
                  ? initialCurrentAttendance.message
                  : "現在の勤怠を取得できませんでした。",
            }
          : {
              status: "unavailable",
              message:
                initialCurrentAttendance.status === "error"
                  ? initialCurrentAttendance.message
                  : "現在の勤怠を取得できませんでした。",
            };

  const rememberCurrentSnapshot = useCallback(() => {
    if (currentSnapshot) setLastCurrentSnapshot(currentSnapshot);
  }, [currentSnapshot]);

  const refreshServer = useCallback(() => {
    rememberCurrentSnapshot();
    startTransition(() => router.refresh());
  }, [rememberCurrentSnapshot, router]);

  return {
    currentSnapshot,
    currentReadState,
    isRefreshing,
    rememberCurrentSnapshot,
    refreshServer,
  };
}

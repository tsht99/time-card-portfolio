"use client";

import type { WorkPeriod } from "@repo/contracts";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { cancelAdminAttendanceAction } from "../../../_actions/attendance-actions.ts";
import { useAuth } from "../../../_components/auth-provider.tsx";
import {
  AdminClientError,
  runAdminAction,
  throwForActionFailure,
} from "../../../_lib/admin-action-client.ts";

type AttendanceCancellationTarget = {
  attendanceId: string;
  eventVersion: number;
  attendanceDate: string;
  displayName: string | null;
  workPeriod: WorkPeriod;
};

export type AttendanceCancellation = {
  cancellationError: AdminClientError | null;
  isCancelling: (attendanceId: string) => boolean;
  cancel: (attendance: AttendanceCancellationTarget) => Promise<boolean>;
};

export function useAttendanceCancellation(): AttendanceCancellation {
  const { authState, reauthenticate, canMutate } = useAuth();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<AdminClientError | null>(null);
  const [variables, setVariables] = useState<{ attendanceId: string } | null>(
    null,
  );
  const submitting = useRef(false);

  async function cancel(
    attendance: AttendanceCancellationTarget,
  ): Promise<boolean> {
    if (authState.status !== "ready" || submitting.current) return false;
    submitting.current = true;
    setVariables({ attendanceId: attendance.attendanceId });
    setError(null);
    return new Promise<boolean>((resolve) => {
      // startTransition does not return its async callback's promise; settle the
      // caller's promise here only after the server action and reauth finish.
      startTransition(async () => {
        let succeeded = false;
        try {
          const result = await runAdminAction(
            () =>
              cancelAdminAttendanceAction({
                attendanceId: attendance.attendanceId,
                expectedVersion: attendance.eventVersion,
              }),
            reauthenticate,
            canMutate,
          );
          throwForActionFailure(result);
          succeeded = true;
          router.refresh();
        } catch (cause) {
          const nextError =
            cause instanceof AdminClientError
              ? cause
              : new AdminClientError("勤怠を取消できませんでした。");
          setError(nextError);
          if (nextError.code === "ATTENDANCE_VERSION_CONFLICT")
            router.refresh();
        } finally {
          submitting.current = false;
          setVariables(null);
          resolve(succeeded);
        }
      });
    });
  }

  return {
    cancellationError: error,
    isCancelling: (attendanceId) =>
      isPending && variables?.attendanceId === attendanceId,
    cancel,
  };
}

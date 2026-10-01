"use client";

import type { WorkPeriod } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { AdminAttendanceActionResult } from "../../../lib/admin-attendance-types";
import { cancelAdminAttendanceAction } from "../_actions/attendance-actions.ts";
import { useAuth } from "../_components/auth-provider.tsx";
import {
  type AdminClientError,
  clientErrorFromAction,
  runAdminAction,
} from "../_lib/admin-action-client.ts";

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
  cancel: (attendance: AttendanceCancellationTarget) => Promise<void>;
};

export function useAttendanceCancellation(): AttendanceCancellation {
  const { authState, reauthenticate } = useAuth();
  const router = useRouter();
  const cancellationMutation = useMutation<
    AdminAttendanceActionResult,
    AdminClientError,
    {
      attendanceId: string;
      expectedVersion: number;
    }
  >({
    mutationFn: ({ attendanceId, expectedVersion }) =>
      runAdminAction(
        () =>
          cancelAdminAttendanceAction({
            attendanceId,
            expectedVersion,
          }),
        reauthenticate,
      ).then((result) => {
        if (!result.success) throw clientErrorFromAction(result);
        return result;
      }),
    onSuccess: () => {
      router.refresh();
    },
    onError: (error) => {
      if (error.code === "ATTENDANCE_VERSION_CONFLICT") router.refresh();
    },
  });

  async function cancel(
    attendance: AttendanceCancellationTarget,
  ): Promise<void> {
    if (authState.status !== "ready" || cancellationMutation.isPending) return;
    try {
      await cancellationMutation.mutateAsync({
        attendanceId: attendance.attendanceId,
        expectedVersion: attendance.eventVersion,
      });
    } catch {
      // The mutation error is exposed through cancellationError for the caller.
    }
  }

  return {
    cancellationError: cancellationMutation.error ?? null,
    isCancelling: (attendanceId) =>
      cancellationMutation.isPending &&
      cancellationMutation.variables?.attendanceId === attendanceId,
    cancel,
  };
}

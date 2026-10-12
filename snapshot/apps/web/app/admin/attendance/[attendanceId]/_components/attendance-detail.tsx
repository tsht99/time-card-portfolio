"use client";

import type { AdminAttendanceDetail } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { useState } from "react";
import { useAuth } from "../../../_components/auth-provider.tsx";
import type { AdminUserListState } from "../../../_lib/admin-user-management-types.ts";
import type { AdminAttendanceDetailState } from "../../_lib/admin-attendance-types.ts";
import { canEditAttendanceTarget } from "../../_lib/attendance-edit-access.ts";
import { useAttendanceCancellation } from "../_hooks/use-attendance-cancellation.ts";
import { AttendanceDetailView } from "./attendance-detail-view.tsx";

function DetailContent({
  detail,
  initialUsers,
  correctionHref,
  canEdit,
}: {
  detail: AdminAttendanceDetail;
  initialUsers: AdminUserListState;
  correctionHref: string;
  canEdit: boolean;
}) {
  const operations = useAttendanceCancellation();
  const [isCancellationOpen, setIsCancellationOpen] = useState(false);
  const operationError = operations.cancellationError;
  const operationErrorMessage =
    operationError?.code === "ATTENDANCE_VERSION_CONFLICT"
      ? "他の操作により勤怠が更新されました。最新の内容を確認してください。"
      : operationError?.message;
  const isCancelling = operations.isCancelling(detail.attendanceId);
  async function confirmCancellation() {
    if (!isCancellationOpen || isCancelling) return;
    const succeeded = await operations.cancel(detail);
    if (succeeded) setIsCancellationOpen(false);
  }

  return (
    <AttendanceDetailView
      detail={detail}
      initialUsers={initialUsers}
      correctionHref={correctionHref}
      canEdit={canEdit}
      isCancellationOpen={isCancellationOpen}
      isCancelling={isCancelling}
      operationErrorMessage={operationErrorMessage ?? null}
      operationErrorKind={operationError?.kind ?? null}
      onOpenCancellation={() => setIsCancellationOpen(true)}
      onOpenChange={(open) => {
        if (!open && !isCancelling) setIsCancellationOpen(false);
      }}
      onConfirmCancellation={confirmCancellation}
    />
  );
}

export function AttendanceDetail({
  initialDetail,
  initialUsers,
  correctionHref,
}: {
  initialDetail: AdminAttendanceDetailState;
  initialUsers: AdminUserListState;
  correctionHref: string;
}) {
  const { authState } = useAuth();
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
            {initialDetail.status === "missing" && (
              <p>勤怠が見つかりません。</p>
            )}
            {(initialDetail.status === "error" ||
              initialDetail.status === "unavailable") && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{initialDetail.message}</AlertDescription>
              </Alert>
            )}
            {initialDetail.status === "ready" && (
              <DetailContent
                detail={initialDetail.data}
                initialUsers={initialUsers}
                correctionHref={correctionHref}
                canEdit={
                  authState.status === "ready" &&
                  canEditAttendanceTarget(
                    initialUsers,
                    authState.user.userId,
                    initialDetail.data.userId,
                  )
                }
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}

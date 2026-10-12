"use client";

import type { AdminAttendanceDetail } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import Link from "next/link";
import { UserContextCard } from "../../../_components/user-context-card.tsx";
import type { AdminUserListState } from "../../../_lib/admin-user-management-types.ts";
import { AttendanceCancellationDialog } from "./attendance-cancellation-dialog.tsx";
import { AttendanceCurrentSummary } from "./attendance-current-summary.tsx";
import { AttendanceHistoryList } from "./attendance-history-list.tsx";

export function AttendanceDetailView({
  detail,
  initialUsers,
  correctionHref,
  canEdit,
  isCancellationOpen,
  isCancelling,
  operationErrorMessage,
  operationErrorKind,
  onOpenCancellation,
  onOpenChange,
  onConfirmCancellation,
}: {
  detail: AdminAttendanceDetail;
  initialUsers: AdminUserListState;
  correctionHref: string;
  canEdit: boolean;
  isCancellationOpen: boolean;
  isCancelling: boolean;
  operationErrorMessage: string | null;
  operationErrorKind: string | null;
  onOpenCancellation: () => void;
  onOpenChange: (open: boolean) => void;
  onConfirmCancellation: () => void;
}) {
  const users = initialUsers.status === "ready" ? initialUsers.data : [];
  return (
    <>
      <UserContextCard displayName={detail.displayName} />
      <AttendanceCurrentSummary
        detail={detail}
        heading="勤怠の現在状態"
        headingId="attendance-detail-summary"
        hourlyWageSettingsHref={`/admin/users/${encodeURIComponent(detail.userId)}/hourly-wage-rules?date=${encodeURIComponent(detail.attendanceDate)}`}
      />
      {detail.status !== "cancelled" && canEdit && (
        <section
          className="mt-6"
          aria-labelledby="attendance-detail-operations"
        >
          <h2
            id="attendance-detail-operations"
            className="text-base font-semibold"
          >
            操作
          </h2>
          {operationErrorMessage && (
            <Alert
              className="mt-3"
              variant={
                operationErrorKind === "session" ? "warning" : "destructive"
              }
            >
              <AlertDescription>{operationErrorMessage}</AlertDescription>
            </Alert>
          )}
          <div className="mt-3 flex flex-col items-center gap-2">
            <Button
              render={<Link href={correctionHref} />}
              variant="outline"
              className="w-full max-w-md justify-start text-left text-zinc-700"
            >
              訂正
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isCancelling}
              onClick={onOpenCancellation}
              className="w-full max-w-md justify-start text-left"
            >
              {isCancelling ? "取消中..." : "取消"}
            </Button>
          </div>
        </section>
      )}
      {detail.status !== "cancelled" && canEdit && (
        <AttendanceCancellationDialog
          isOpen={isCancellationOpen}
          displayName={detail.displayName}
          attendanceDate={detail.attendanceDate}
          workPeriod={detail.workPeriod}
          isCancelling={isCancelling}
          onOpenChange={onOpenChange}
          onConfirm={onConfirmCancellation}
        />
      )}
      <section className="mt-6" aria-labelledby="attendance-detail-history">
        <h2 id="attendance-detail-history" className="text-base font-semibold">
          変更履歴
        </h2>
        {detail.history.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">勤怠の履歴はありません。</p>
        ) : (
          <div className="mt-3">
            <AttendanceHistoryList events={detail.history} users={users} />
          </div>
        )}
      </section>
    </>
  );
}

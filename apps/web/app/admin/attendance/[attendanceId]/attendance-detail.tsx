"use client";

import type { AdminAttendanceDetail } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import Link from "next/link";
import { useState } from "react";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import type { AdminAttendanceDetailState } from "../../../../lib/admin-attendance-types";
import type { AdminUsersState } from "../../../../lib/admin-user-management-types";
import { useAuth } from "../../_components/auth-provider.tsx";
import { UserContextCard } from "../../_components/user-context-card.tsx";
import { useAttendanceCancellation } from "../attendance-cancellation";
import { AttendanceCurrentSummary } from "../attendance-current-summary";
import { canEditAttendanceTarget } from "../attendance-edit-access";
import { formatAttendanceDate } from "../attendance-format";
import { AttendanceHistoryList } from "../attendance-history-list";

function DetailContent({
  detail,
  initialUsers,
  correctionHref,
  canEdit,
}: {
  detail: AdminAttendanceDetail;
  initialUsers: AdminUsersState;
  correctionHref: string;
  canEdit: boolean;
}) {
  const users = initialUsers.status === "ready" ? initialUsers.data : [];
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
    await operations.cancel(detail);
    setIsCancellationOpen(false);
  }

  return (
    <>
      <UserContextCard displayName={detail.displayName} />
      <AttendanceCurrentSummary
        detail={detail}
        heading="勤怠の現在状態"
        headingId="attendance-detail-summary"
        hourlyWageSettingsHref={`/admin/users/${encodeURIComponent(detail.userId)}/hourly-wage-rates?date=${encodeURIComponent(detail.attendanceDate)}`}
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
                operationError?.kind === "session" ? "warning" : "destructive"
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
              onClick={() => setIsCancellationOpen(true)}
              className="w-full max-w-md justify-start text-left"
            >
              {isCancelling ? "取消中..." : "取消"}
            </Button>
          </div>
        </section>
      )}
      {detail.status !== "cancelled" && canEdit && (
        <Dialog
          open={isCancellationOpen}
          onOpenChange={(open) => {
            if (!open && !isCancelling) setIsCancellationOpen(false);
          }}
        >
          <DialogContent showCloseButton={!isCancelling}>
            <DialogHeader>
              <DialogTitle>勤怠を取消</DialogTitle>
              <DialogDescription>取消後は元に戻せません。</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md bg-zinc-50 p-3 text-sm">
              <dt>対象利用者</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                {detail.displayName ?? "名前未設定"}
              </dd>
              <dt>勤務日</dt>
              <dd>{formatAttendanceDate(detail.attendanceDate)}</dd>
              <dt>勤務区分</dt>
              <dd>
                <WorkPeriodLabel workPeriod={detail.workPeriod} />
              </dd>
            </dl>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCancellationOpen(false)}
                disabled={isCancelling}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirmCancellation}
                disabled={isCancelling}
              >
                {isCancelling ? "取消中..." : "取消する"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

export function AttendanceDetail({
  initialDetail,
  initialUsers,
  correctionHref,
}: {
  initialDetail: AdminAttendanceDetailState;
  initialUsers: AdminUsersState;
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

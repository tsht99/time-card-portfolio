"use client";

import type { WorkPeriod } from "@repo/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import { formatAttendanceDate } from "../../_lib/attendance-format.ts";

export function AttendanceCancellationDialog({
  isOpen,
  displayName,
  attendanceDate,
  workPeriod,
  isCancelling = false,
  onOpenChange,
  onConfirm,
}: {
  isOpen: boolean;
  displayName: string | null;
  attendanceDate: string;
  workPeriod: WorkPeriod;
  isCancelling?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!isCancelling}>
        <DialogHeader>
          <DialogTitle>勤怠を取消</DialogTitle>
          <DialogDescription>取消後は元に戻せません。</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md bg-zinc-50 p-3 text-sm">
          <dt>対象利用者</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            {displayName ?? "名前未設定"}
          </dd>
          <dt>勤務日</dt>
          <dd>{formatAttendanceDate(attendanceDate)}</dd>
          <dt>勤務区分</dt>
          <dd>
            <WorkPeriodLabel workPeriod={workPeriod} />
          </dd>
        </dl>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCancelling}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isCancelling}
          >
            {isCancelling ? "取消中..." : "取消する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

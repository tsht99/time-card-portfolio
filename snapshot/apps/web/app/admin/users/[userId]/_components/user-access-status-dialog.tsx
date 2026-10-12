"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";

export function UserAccessStatusDialog({
  open,
  displayName,
  currentStatus,
  nextStatus,
  title,
  actionLabel,
  pending = false,
  errorMessage = null,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  displayName: string;
  currentStatus: string;
  nextStatus: string;
  title: string;
  actionLabel: string;
  pending?: boolean;
  errorMessage?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md bg-zinc-50 p-3 text-sm">
          <dt>対象スタッフ</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{displayName}</dd>
          <dt>現在の状態</dt>
          <dd>{currentStatus}</dd>
          <dt>変更後の状態</dt>
          <dd>{nextStatus}</dd>
        </dl>
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            キャンセル
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending ? "更新中" : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

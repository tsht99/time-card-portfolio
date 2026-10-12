"use client";

import { MAX_HOURLY_WAGE } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";

export function HourlyWageBulkEditDate({
  bulkDate,
  drafts,
  isPending,
  onDateChange,
  onRequestDiscard,
}: {
  bulkDate: string;
  drafts: Record<string, string>;
  isPending: boolean;
  onDateChange: (date: string) => void;
  onRequestDiscard: (date: string) => void;
}) {
  function requestDate(date: string) {
    if (Object.values(drafts).some((value) => value !== ""))
      onRequestDiscard(date);
    else onDateChange(date);
  }

  return (
    <Input
      aria-label="適用開始日"
      type="date"
      value={bulkDate}
      disabled={isPending}
      onChange={(event) => requestDate(event.target.value)}
      className="mt-3 bg-white"
    />
  );
}

export function HourlyWageBulkEditActions({
  isPending,
  hasInvalidDraft,
  hasChanges,
  errorMessage,
  pendingDate,
  onCancel,
  onSave,
  onDismissDiscard,
  onConfirmDiscard,
}: {
  isPending: boolean;
  hasInvalidDraft: boolean;
  hasChanges: boolean;
  errorMessage?: string;
  pendingDate: string | null;
  onCancel: () => void;
  onSave: () => void;
  onDismissDiscard: () => void;
  onConfirmDiscard: (date: string) => void;
}) {
  return (
    <>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onCancel}
        >
          キャンセル
        </Button>
        <Button
          type="button"
          disabled={isPending || hasInvalidDraft || !hasChanges}
          onClick={onSave}
        >
          {isPending ? "保存中" : "保存"}
        </Button>
        {errorMessage && (
          <Alert variant="destructive" className="w-full">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
      </div>
      {hasInvalidDraft && (
        <Alert variant="warning" className="mt-2">
          <AlertDescription>
            時給は0以上{MAX_HOURLY_WAGE.toLocaleString("ja-JP")}
            以下の整数で入力してください。
          </AlertDescription>
        </Alert>
      )}
      {pendingDate !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) onDismissDiscard();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>入力内容を破棄しますか？</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onDismissDiscard}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => onConfirmDiscard(pendingDate)}
              >
                破棄して変更
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

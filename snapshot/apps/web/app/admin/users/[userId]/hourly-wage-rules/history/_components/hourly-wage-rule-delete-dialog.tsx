"use client";

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
import type { HourlyWageRuleHistoryEntry } from "../_lib/history-model";

const dayLabels: Record<HourlyWageRuleHistoryEntry["dayType"], string> = {
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土",
  sun: "日",
  holiday: "祝日",
};

export function HourlyWageRuleDeleteDialog({
  hourlyWageRule,
  errorMessage,
  pending,
  canSubmit,
  onOpenChange,
  onCancel,
  onConfirm,
}: {
  hourlyWageRule: HourlyWageRuleHistoryEntry | null;
  errorMessage: string | null;
  pending: boolean;
  canSubmit: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: (hourlyWageRule: HourlyWageRuleHistoryEntry) => void;
}) {
  return (
    <Dialog open={hourlyWageRule !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>時給ルールを削除</DialogTitle>
          <DialogDescription>
            このルールを削除すると、その期間は直前のルール、存在しなければ未設定が適用されます。
          </DialogDescription>
        </DialogHeader>
        {hourlyWageRule && (
          <p className="text-sm">
            {hourlyWageRule.effectiveFrom.replaceAll("-", "/")}・
            {dayLabels[hourlyWageRule.dayType]}・
            {hourlyWageRule.workPeriod === "day" ? "昼" : "夜"}・
            {hourlyWageRule.hourlyWage.toLocaleString("ja-JP")}円
          </p>
        )}
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onCancel}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || !hourlyWageRule || !canSubmit}
            onClick={() => hourlyWageRule && onConfirm(hourlyWageRule)}
          >
            {pending ? "削除中..." : "削除する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

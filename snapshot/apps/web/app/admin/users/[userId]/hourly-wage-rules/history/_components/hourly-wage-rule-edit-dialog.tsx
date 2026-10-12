"use client";

import type { UpdateHourlyWageRuleRequest } from "@repo/contracts";
import { createHourlyWageRuleRequestSchema } from "@repo/contracts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import type { HourlyWageRuleHistoryEntry } from "../_lib/history-model";

export type HourlyWageRuleDraft = {
  workPeriod: HourlyWageRuleHistoryEntry["workPeriod"];
  dayType: HourlyWageRuleHistoryEntry["dayType"];
  hourlyWage: string;
  effectiveFrom: string;
};

const periods: HourlyWageRuleHistoryEntry["workPeriod"][] = ["day", "night"];
const days: HourlyWageRuleHistoryEntry["dayType"][] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
];
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

export function HourlyWageRuleEditDialog({
  hourlyWageRule,
  draft,
  errorMessage,
  pending,
  canSubmit,
  onOpenChange,
  onCancel,
  onDraftChange,
  onErrorMessageChange,
  onSubmit,
}: {
  hourlyWageRule: HourlyWageRuleHistoryEntry | null;
  draft: HourlyWageRuleDraft;
  errorMessage: string | null;
  pending: boolean;
  canSubmit: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onDraftChange: (draft: HourlyWageRuleDraft) => void;
  onErrorMessageChange: (message: string | null) => void;
  onSubmit: (
    hourlyWageRule: HourlyWageRuleHistoryEntry,
    request: UpdateHourlyWageRuleRequest,
  ) => void;
}) {
  return (
    <Dialog open={hourlyWageRule !== null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>時給ルールを訂正</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!hourlyWageRule || pending) return;
            if (draft.hourlyWage.trim() === "") {
              onErrorMessageChange("時給を入力してください。");
              return;
            }
            const parsed = createHourlyWageRuleRequestSchema.safeParse({
              ...draft,
              hourlyWage: Number(draft.hourlyWage),
            });
            if (!parsed.success) {
              onErrorMessageChange("入力内容を確認してください。");
              return;
            }
            onErrorMessageChange(null);
            onSubmit(hourlyWageRule, {
              ...parsed.data,
              expectedVersion: hourlyWageRule.version,
            });
          }}
        >
          <div className="grid gap-1 text-sm">
            <span>勤務区分</span>
            <Select
              value={draft.workPeriod}
              disabled={pending}
              onValueChange={(value) =>
                value &&
                onDraftChange({
                  ...draft,
                  workPeriod: value as HourlyWageRuleHistoryEntry["workPeriod"],
                })
              }
            >
              <SelectTrigger aria-label="勤務区分">
                <SelectValue>
                  {draft.workPeriod === "day" ? "昼" : "夜"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {periods.map((period) => (
                  <SelectItem key={period} value={period}>
                    {period === "day" ? "昼" : "夜"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 text-sm">
            <span>日区分</span>
            <Select
              value={draft.dayType}
              disabled={pending}
              onValueChange={(value) =>
                value &&
                onDraftChange({
                  ...draft,
                  dayType: value as HourlyWageRuleHistoryEntry["dayType"],
                })
              }
            >
              <SelectTrigger aria-label="日区分">
                <SelectValue>{dayLabels[draft.dayType]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {days.map((day) => (
                  <SelectItem key={day} value={day}>
                    {dayLabels[day]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label htmlFor="edit-hourly-wage" className="grid gap-1 text-sm">
            時給
            <Input
              id="edit-hourly-wage"
              aria-label="時給"
              type="number"
              min="0"
              step="1"
              value={draft.hourlyWage}
              disabled={pending}
              onChange={(e) =>
                onDraftChange({ ...draft, hourlyWage: e.target.value })
              }
            />
          </label>
          <label htmlFor="edit-effective-from" className="grid gap-1 text-sm">
            適用開始日
            <Input
              id="edit-effective-from"
              aria-label="適用開始日"
              type="date"
              value={draft.effectiveFrom}
              disabled={pending}
              onChange={(e) =>
                onDraftChange({ ...draft, effectiveFrom: e.target.value })
              }
            />
          </label>
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
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? "保存中" : "訂正する"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

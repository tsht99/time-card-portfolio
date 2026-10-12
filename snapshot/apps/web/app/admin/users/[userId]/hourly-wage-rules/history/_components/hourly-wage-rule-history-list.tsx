"use client";

import { Button } from "@repo/ui/components/button";
import { Pencil, Trash2 } from "lucide-react";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import { getTokyoDate } from "../../../../../../../lib/tokyo-date-time";
import type {
  HourlyWageRuleHistoryEntry,
  HourlyWageRuleHistoryGroup,
} from "../_lib/history-model";

function weekdayClass(dayType: HourlyWageRuleHistoryEntry["dayType"]) {
  if (dayType === "sat") return "text-blue-700";
  if (dayType === "sun" || dayType === "holiday") return "text-red-700";
  return "";
}

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

export function HourlyWageRuleHistoryList({
  groups,
  canEdit,
  onEdit,
  onDelete,
}: {
  groups: HourlyWageRuleHistoryGroup[];
  canEdit: boolean;
  onEdit: (hourlyWageRule: HourlyWageRuleHistoryEntry) => void;
  onDelete: (hourlyWageRule: HourlyWageRuleHistoryEntry) => void;
}) {
  const today = getTokyoDate(new Date());
  const future = groups.filter((group) => group.effectiveFrom > today);
  const past = groups.filter((group) => group.effectiveFrom <= today);
  return (
    <div className="mt-6 grid gap-8">
      {future.length > 0 && (
        <HistorySection
          title="適用予定"
          groups={future}
          canEdit={canEdit}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      {past.length > 0 && (
        <HistorySection
          title="過去の変更"
          groups={past}
          canEdit={canEdit}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function HistorySection({
  title,
  groups,
  canEdit,
  onEdit,
  onDelete,
}: {
  title: string;
  groups: HourlyWageRuleHistoryGroup[];
  canEdit: boolean;
  onEdit: (hourlyWageRule: HourlyWageRuleHistoryEntry) => void;
  onDelete: (hourlyWageRule: HourlyWageRuleHistoryEntry) => void;
}) {
  return (
    <section aria-labelledby={`history-${title}`}>
      <h2 id={`history-${title}`} className="text-base font-semibold">
        {title}
      </h2>
      <div className="mt-3 grid gap-3">
        {groups.map(({ effectiveFrom, changes }) => (
          <article
            key={effectiveFrom}
            className="rounded-md border border-zinc-200 bg-white p-4"
          >
            <h3 className="font-semibold tabular-nums">
              {effectiveFrom.replaceAll("-", "/")}から
            </h3>
            <ul className="mt-3 grid gap-2">
              {changes.map(({ hourlyWageRule, previous }) => (
                <li
                  key={hourlyWageRule.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  <span
                    className={`min-w-8 font-medium ${weekdayClass(hourlyWageRule.dayType)}`}
                  >
                    {dayLabels[hourlyWageRule.dayType]}
                  </span>
                  <WorkPeriodLabel workPeriod={hourlyWageRule.workPeriod} />
                  <span className="tabular-nums">
                    {previous === null
                      ? "未設定"
                      : `${previous.toLocaleString("ja-JP")}円`}{" "}
                    → {hourlyWageRule.hourlyWage.toLocaleString("ja-JP")}円
                  </span>
                  {canEdit && (
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="時給ルールを訂正"
                        title="時給ルールを訂正"
                        onClick={() => onEdit(hourlyWageRule)}
                        className="text-zinc-700"
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="時給ルールを削除"
                        title="時給ルールを削除"
                        onClick={() => onDelete(hourlyWageRule)}
                        className="text-red-700"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

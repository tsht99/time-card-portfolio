"use client";

import { MAX_HOURLY_WAGE } from "@repo/contracts";
import { Input } from "@repo/ui/components/input";
import { CornerDownRight } from "lucide-react";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import {
  dayTypeLabels,
  type HourlyWageRule,
  matrixDayTypes,
  parseBulkHourlyWageRuleDraft,
} from "../_lib/hourly-wage-rule-presentation";

function dayTypeClassName(dayType: HourlyWageRule["dayType"]) {
  if (dayType === "sat") return "text-blue-700";
  if (dayType === "sun" || dayType === "holiday") return "text-red-700";
  return "";
}

export function HourlyWageMatrix({
  hourlyWageRules,
  userId,
  baselineDate,
  editing = false,
  drafts,
  onDraftChange,
  disabled = false,
  isValidHourlyWage,
  findApplicableHourlyWageRule,
}: {
  hourlyWageRules: readonly HourlyWageRule[];
  userId: string;
  baselineDate: string;
  editing?: boolean;
  drafts?: Record<string, string>;
  onDraftChange?: (key: string, value: string) => void;
  disabled?: boolean;
  isValidHourlyWage: (value: unknown) => value is number;
  findApplicableHourlyWageRule: (
    hourlyWageRules: readonly HourlyWageRule[],
    selection: {
      userId: string;
      workPeriod: HourlyWageRule["workPeriod"];
      dayType: HourlyWageRule["dayType"];
      attendanceDate: string;
    },
  ) => HourlyWageRule | null;
}) {
  return (
    <table className="mt-3 w-full table-fixed border-collapse text-left text-xs">
      <caption className="sr-only">曜日別・昼夜別の時給</caption>
      <thead>
        <tr>
          <th scope="col" className="w-[22%] border-b border-zinc-300 p-2">
            <span className="sr-only">日区分</span>
          </th>
          <th scope="col" className="w-[39%] border-b border-zinc-300 p-2">
            <WorkPeriodLabel workPeriod="day" />
          </th>
          <th scope="col" className="w-[39%] border-b border-zinc-300 p-2">
            <WorkPeriodLabel workPeriod="night" />
          </th>
        </tr>
      </thead>
      <tbody>
        {matrixDayTypes.map((dayType) => (
          <tr key={dayType}>
            <th
              scope="row"
              className={`border-b border-zinc-200 p-2 align-top font-medium ${dayTypeClassName(dayType)}`}
            >
              {dayTypeLabels[dayType]}
            </th>
            {(["day", "night"] as const).map((workPeriod) => {
              const selectedHourlyWageRule = findApplicableHourlyWageRule(
                hourlyWageRules,
                {
                  userId,
                  workPeriod,
                  dayType,
                  attendanceDate: baselineDate,
                },
              );
              const draftKey = `${dayType}:${workPeriod}`;
              const draftValue = drafts?.[draftKey] ?? "";
              const draftValueNumber = parseBulkHourlyWageRuleDraft(
                draftValue,
                isValidHourlyWage,
              );
              return (
                <td
                  key={workPeriod}
                  className="border-b border-zinc-200 p-2 align-top break-words"
                >
                  <span className="font-semibold tabular-nums">
                    {selectedHourlyWageRule
                      ? `${selectedHourlyWageRule.hourlyWage.toLocaleString("ja-JP")}円`
                      : "未設定"}
                  </span>
                  {editing && (
                    <div className="mt-2 flex items-center gap-1">
                      <CornerDownRight
                        aria-hidden="true"
                        className="size-3 shrink-0 text-zinc-500"
                      />
                      <Input
                        id={`bulk-wage-${dayType}-${workPeriod}`}
                        aria-label={`${dayTypeLabels[dayType]} ${workPeriod === "day" ? "昼" : "夜"}の変更時給`}
                        aria-invalid={
                          draftValue !== "" && draftValueNumber === null
                        }
                        aria-describedby={
                          draftValue !== "" && draftValueNumber === null
                            ? `bulk-wage-error-${dayType}-${workPeriod}`
                            : undefined
                        }
                        inputMode="numeric"
                        type="number"
                        disabled={disabled}
                        step={1}
                        value={draftValue}
                        onChange={(event) =>
                          onDraftChange?.(draftKey, event.target.value)
                        }
                      />
                      {draftValue !== "" && draftValueNumber === null && (
                        <span
                          id={`bulk-wage-error-${dayType}-${workPeriod}`}
                          className="sr-only"
                        >
                          時給は0以上{MAX_HOURLY_WAGE.toLocaleString("ja-JP")}
                          以下の整数で入力してください。
                        </span>
                      )}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

"use client";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { formatMonth, isValidMonth, shiftMonth } from "../../lib/month";

export function MonthNavigation({
  selectedMonth,
  ariaLabel,
  onMonthChange,
  allowDirectSelection = false,
}: {
  selectedMonth: string;
  ariaLabel: string;
  onMonthChange: (month: string) => void;
  allowDirectSelection?: boolean;
}) {
  const [isSelectingMonth, setIsSelectingMonth] = useState(false);
  const [draftMonth, setDraftMonth] = useState(selectedMonth);

  function openMonthPicker() {
    setDraftMonth(selectedMonth);
    setIsSelectingMonth(true);
  }

  function closeMonthPicker() {
    setIsSelectingMonth(false);
  }

  function selectMonth(value: string) {
    setDraftMonth(value);
    if (!isValidMonth(value) || !allowDirectSelection) return;
    onMonthChange(value);
    closeMonthPicker();
  }

  const previousMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);
  return (
    <fieldset
      aria-label={ariaLabel}
      className="flex min-w-0 items-center justify-center gap-2"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="前の月"
        onClick={() => previousMonth && onMonthChange(previousMonth)}
        disabled={previousMonth === null}
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
      </Button>
      <h2
        aria-label={formatMonth(selectedMonth)}
        className="min-w-20 text-center text-lg font-semibold"
      >
        {allowDirectSelection && isSelectingMonth ? (
          <span className="flex items-center justify-center gap-1">
            <Input
              type="month"
              aria-label="月を直接選択"
              value={draftMonth}
              onChange={(event) => selectMonth(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeMonthPicker();
              }}
              autoFocus
              className="w-32 bg-white font-normal"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="月選択を中止"
              onClick={closeMonthPicker}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </span>
        ) : allowDirectSelection ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            aria-label="月を直接選択"
            onClick={openMonthPicker}
            className="min-w-20 px-1 text-lg font-semibold text-zinc-950"
          >
            {formatMonth(selectedMonth)}
          </Button>
        ) : (
          formatMonth(selectedMonth)
        )}
      </h2>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="次の月"
        onClick={() => nextMonth && onMonthChange(nextMonth)}
        disabled={nextMonth === null}
      >
        <ChevronRight aria-hidden="true" className="size-5" />
      </Button>
    </fieldset>
  );
}

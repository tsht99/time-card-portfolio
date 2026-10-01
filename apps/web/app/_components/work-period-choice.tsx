import type { FocusEventHandler, Ref } from "react";

import { WorkPeriodIcon } from "./work-period-icon";

type WorkPeriodChoiceValue = "" | "day" | "night";

type WorkPeriodChoiceProps = {
  value: WorkPeriodChoiceValue;
  onValueChange: (value: WorkPeriodChoiceValue) => void;
  name: string;
  legend: string;
  showAll?: boolean;
  disabled?: boolean;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  inputRef?: Ref<HTMLInputElement>;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
};

const workPeriodOptions = [
  {
    value: "day" as const,
    label: "昼",
    selectedClass: "border-2 border-amber-500 bg-amber-50 text-amber-800",
  },
  {
    value: "night" as const,
    label: "夜",
    selectedClass: "border-2 border-indigo-500 bg-indigo-50 text-indigo-700",
  },
] as const;

function WorkPeriodChoice({
  value,
  onValueChange,
  name,
  legend,
  showAll = false,
  disabled = false,
  onBlur,
  inputRef,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: WorkPeriodChoiceProps) {
  const options = showAll
    ? [
        {
          value: "" as const,
          label: "すべて",
          selectedClass: "border-2 border-zinc-600 bg-zinc-100 text-zinc-800",
        },
        ...workPeriodOptions,
      ]
    : workPeriodOptions;

  return (
    <fieldset
      disabled={disabled}
      aria-label={legend}
      className="flex min-w-0 flex-col gap-1 text-sm font-medium"
    >
      <legend>{legend}</legend>
      <div
        className={`grid min-w-0 gap-2 ${showAll ? "grid-cols-3" : "grid-cols-2"}`}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value || "all"}
              className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium outline-none transition-colors focus-within:ring-2 focus-within:ring-zinc-500 focus-within:ring-offset-2 ${selected ? option.selectedClass : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-invalid is a valid global property on radio inputs. */}
              <input
                ref={inputRef}
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onValueChange(option.value)}
                onBlur={onBlur}
                aria-invalid={ariaInvalid}
                aria-describedby={ariaDescribedBy}
                className="sr-only"
              />
              {option.value !== "" && (
                <WorkPeriodIcon workPeriod={option.value} />
              )}
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export { WorkPeriodChoice };

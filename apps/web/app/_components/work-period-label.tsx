import { Moon, Sun } from "lucide-react";

type WorkPeriod = "day" | "night";

type WorkPeriodLabelProps = {
  workPeriod: WorkPeriod;
};

function WorkPeriodLabel({ workPeriod }: WorkPeriodLabelProps) {
  if (workPeriod === "day") {
    return (
      <span className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 text-xs leading-5 font-medium text-amber-800">
        <Sun className="size-3.5 shrink-0" aria-hidden="true" />
        <span>昼</span>
      </span>
    );
  }

  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs leading-5 font-medium text-indigo-700">
      <Moon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>夜</span>
    </span>
  );
}

export { WorkPeriodLabel };

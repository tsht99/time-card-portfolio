import { Moon, Sun } from "lucide-react";

type WorkPeriodIconProps = {
  workPeriod: "day" | "night";
};

function WorkPeriodIcon({ workPeriod }: WorkPeriodIconProps) {
  if (workPeriod === "day") {
    return (
      <Sun className="size-5 shrink-0 text-amber-400" aria-hidden="true" />
    );
  }

  return (
    <Moon className="size-5 shrink-0 text-indigo-300" aria-hidden="true" />
  );
}

export { WorkPeriodIcon };

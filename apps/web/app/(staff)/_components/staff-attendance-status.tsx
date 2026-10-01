import { House, Moon, Sun } from "lucide-react";

type StaffAttendanceStatusProps = {
  status: "not_working" | "working_day" | "working_night";
};

function StaffAttendanceStatus({ status }: StaffAttendanceStatusProps) {
  if (status === "not_working") {
    return (
      <span className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-zinc-100 px-1.5 py-0.5 text-lg font-semibold text-zinc-700">
        <House className="size-4 shrink-0" aria-hidden="true" />
        <span>未勤務</span>
      </span>
    );
  }

  if (status === "working_day") {
    return (
      <span className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 text-lg font-semibold text-amber-800">
        <Sun className="size-4 shrink-0" aria-hidden="true" />
        <span>昼勤務中</span>
      </span>
    );
  }

  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-indigo-50 px-1.5 py-0.5 text-lg font-semibold text-indigo-700">
      <Moon className="size-4 shrink-0" aria-hidden="true" />
      <span>夜勤務中</span>
    </span>
  );
}

export { StaffAttendanceStatus };

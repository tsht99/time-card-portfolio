import type { AttendanceListStatus, WorkPeriod } from "@repo/contracts";

export type AttendanceFilters = {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
  userId: string;
  workPeriod: "" | WorkPeriod;
  status: "" | AttendanceListStatus | "cancelled";
};

const attendanceDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function getTokyoDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function getDefaultAttendanceFilters(
  now: Date = new Date(),
): AttendanceFilters {
  const endAttendanceDateInclusive = getTokyoDate(now);
  const startDate = new Date(`${endAttendanceDateInclusive}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const startAttendanceDateInclusive = startDate.toISOString().slice(0, 10);
  return {
    startAttendanceDateInclusive,
    endAttendanceDateInclusive,
    userId: "",
    workPeriod: "",
    status: "",
  };
}

export function isValidAttendanceDateRange(
  startAttendanceDateInclusive: string,
  endAttendanceDateInclusive: string,
): boolean {
  if (
    !isValidAttendanceDate(startAttendanceDateInclusive) ||
    !isValidAttendanceDate(endAttendanceDateInclusive)
  ) {
    return false;
  }
  return startAttendanceDateInclusive <= endAttendanceDateInclusive;
}

function isValidAttendanceDate(value: string): boolean {
  const match = attendanceDatePattern.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  daysInMonth.setUTCMonth(daysInMonth.getUTCMonth() + 1, 0);
  return (
    day <= daysInMonth.getUTCDate() && daysInMonth.getUTCFullYear() === year
  );
}

export function parseAttendanceFilters(
  searchParams: URLSearchParams,
  now?: Date,
): AttendanceFilters {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from === null || to === null || !isValidAttendanceDateRange(from, to)) {
    return getDefaultAttendanceFilters(now);
  }

  const userId = searchParams.get("userId") ?? "";
  const workPeriodValue = searchParams.get("workPeriod");
  const statusValue = searchParams.get("status");
  return {
    startAttendanceDateInclusive: from,
    endAttendanceDateInclusive: to,
    userId,
    workPeriod:
      workPeriodValue === "day" || workPeriodValue === "night"
        ? workPeriodValue
        : "",
    status:
      statusValue === "working" ||
      statusValue === "completed" ||
      statusValue === "cancelled"
        ? statusValue
        : "",
  };
}

export function serializeAttendanceFilters(
  filters: AttendanceFilters,
): URLSearchParams {
  const searchParams = new URLSearchParams({
    from: filters.startAttendanceDateInclusive,
    to: filters.endAttendanceDateInclusive,
  });
  if (filters.userId !== "") searchParams.set("userId", filters.userId);
  if (filters.workPeriod !== "")
    searchParams.set("workPeriod", filters.workPeriod);
  if (filters.status !== "") searchParams.set("status", filters.status);
  return searchParams;
}

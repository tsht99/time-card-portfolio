import holidayJp from "@holiday-jp/holiday_jp";

import type { HourlyWageDayType } from "./hourly-wage-rate.ts";

const dayTypesByUtcDay = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const satisfies readonly HourlyWageDayType[];

function parseCalendarDate(attendanceDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
    throw new RangeError(`Invalid attendance date: ${attendanceDate}`);
  }

  const date = new Date(`${attendanceDate}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== attendanceDate
  ) {
    throw new RangeError(`Invalid attendance date: ${attendanceDate}`);
  }

  return date;
}

export function getHourlyWageDayType(
  attendanceDate: string,
): HourlyWageDayType {
  const date = parseCalendarDate(attendanceDate);

  if (holidayJp.isHoliday(attendanceDate)) {
    return "holiday";
  }

  return dayTypesByUtcDay[date.getUTCDay()];
}

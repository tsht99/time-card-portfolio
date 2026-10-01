import { formatTokyoTime } from "./display-date-time";

const TOKYO_TIME_ZONE = "Asia/Tokyo";

export function getCurrentTime(now = new Date()) {
  return formatTokyoTime(now);
}

export function formatTime(value: string | null) {
  if (!value) return "--:--";
  return formatTokyoTime(value);
}

function getTodayDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TIME_ZONE,
  }).format(now);
}

export function formatStaffClockOutTime(
  clockOutAt: string,
  attendanceDate: string,
) {
  const formattedTime = formatTime(clockOutAt);
  const clockOutDate = getTodayDate(new Date(clockOutAt));
  const [year, month, day] = attendanceDate.split("-").map(Number);
  const nextAttendanceDate = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = `${nextAttendanceDate.getUTCFullYear()}-${String(
    nextAttendanceDate.getUTCMonth() + 1,
  ).padStart(
    2,
    "0",
  )}-${String(nextAttendanceDate.getUTCDate()).padStart(2, "0")}`;

  if (clockOutDate !== nextDate) return formattedTime;

  const [hours, minutes] = formattedTime.split(":");
  return `${Number(hours) + 24}:${minutes}`;
}

export function getMillisecondsUntilNextTokyoMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TOKYO_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const nextTokyoMidnight =
    Date.UTC(year, month - 1, day + 1) - 9 * 60 * 60 * 1000;
  return nextTokyoMidnight - now.getTime();
}

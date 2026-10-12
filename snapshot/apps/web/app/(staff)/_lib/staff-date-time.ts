import {
  formatTokyoTime,
  getMillisecondsUntilNextTokyoMidnight,
  getTokyoDate,
} from "../../../lib/tokyo-date-time";

export function getCurrentStaffDateTime(now = new Date()) {
  return { date: getTokyoDate(now), time: formatTokyoTime(now) };
}

export function toOccurredAt(date: string, time: string) {
  return `${date}T${time}:00+09:00`;
}

export { getMillisecondsUntilNextTokyoMidnight };

export function formatTime(value: string | null) {
  if (!value) return "--:--";
  return formatTokyoTime(value);
}

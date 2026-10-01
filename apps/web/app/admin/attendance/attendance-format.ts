import { formatTokyoTime } from "../../../lib/display-date-time";

export function formatAttendanceDate(value: string) {
  return value.replaceAll("-", "/");
}

export function formatAttendanceTime(value: string) {
  return formatTokyoTime(value);
}

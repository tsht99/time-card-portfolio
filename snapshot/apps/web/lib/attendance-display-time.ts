import { formatTokyoTime, getTokyoDate } from "./tokyo-date-time";

export function formatStaffClockOutTime(
  clockOutAt: string,
  attendanceDate: string,
) {
  const formattedTime = formatTokyoTime(clockOutAt);
  const clockOutDate = getTokyoDate(clockOutAt);
  const attendanceDay = new Date(`${attendanceDate}T00:00:00.000Z`);
  const clockOutDay = new Date(`${clockOutDate}T00:00:00.000Z`);
  const dayDifference =
    (clockOutDay.getTime() - attendanceDay.getTime()) / (24 * 60 * 60 * 1000);

  if (!Number.isInteger(dayDifference) || dayDifference <= 0) {
    return formattedTime;
  }

  const [hours, minutes] = formattedTime.split(":");
  return `${dayDifference * 24 + Number(hours)}:${minutes}`;
}

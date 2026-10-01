const TOKYO_TIME_ZONE = "Asia/Tokyo";
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function isValidMonth(month: string): boolean {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return false;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  return year >= 1 && year <= 9999 && monthNumber >= 1 && monthNumber <= 12;
}

export function shiftMonth(month: string, offset: number): string | null {
  if (!isValidMonth(month) || !Number.isInteger(offset)) return null;
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;
  const absoluteMonth =
    (Number(match[1]) - 1) * 12 + Number(match[2]) - 1 + offset;
  if (absoluteMonth < 0 || absoluteMonth > 9999 * 12 - 1) return null;
  const year = Math.floor(absoluteMonth / 12) + 1;
  const monthNumber = (absoluteMonth % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

export function getCurrentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TOKYO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "0001";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return month;
  return `${match[1]}年${Number(match[2])}月`;
}

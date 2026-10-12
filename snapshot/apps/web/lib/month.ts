import { yearMonthSchema } from "@repo/contracts";
import { getTokyoMonth } from "./tokyo-date-time";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function isValidMonth(month: string): boolean {
  return yearMonthSchema.safeParse(month).success;
}

export function shiftMonth(month: string, offset: number): string | null {
  if (!isValidMonth(month) || !Number.isInteger(offset)) return null;
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;
  const absoluteMonth =
    (Number(match[1]) - 1) * 12 + Number(match[2]) - 1 + offset;
  if (absoluteMonth < 0 || absoluteMonth > 9999 * 12 - 2) return null;
  const year = Math.floor(absoluteMonth / 12) + 1;
  const monthNumber = (absoluteMonth % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

export function getCurrentMonth(now = new Date()): string {
  return getTokyoMonth(now);
}

export function formatMonth(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return month;
  return `${match[1]}年${Number(match[2])}月`;
}

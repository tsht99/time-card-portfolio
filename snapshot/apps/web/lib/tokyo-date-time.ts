const TOKYO_TIME_ZONE = "Asia/Tokyo";

type DateTimeInput = Date | string;

const tokyoTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TOKYO_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const tokyoDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TOKYO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const tokyoDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TOKYO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const tokyoMonthPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TOKYO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

const tokyoWeekdayFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TOKYO_TIME_ZONE,
  weekday: "short",
});

function toDate(value: DateTimeInput) {
  return value instanceof Date ? value : new Date(value);
}

function getParts(formatter: Intl.DateTimeFormat, value: DateTimeInput) {
  return Object.fromEntries(
    formatter
      .formatToParts(toDate(value))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, partValue]),
  );
}

export function formatTokyoTime(value: DateTimeInput) {
  return tokyoTimeFormatter.format(toDate(value));
}

export function formatTokyoDateTime(value: DateTimeInput) {
  return tokyoDateTimeFormatter.format(toDate(value));
}

export function getTokyoDate(value: DateTimeInput): string {
  const parts = getParts(tokyoDatePartsFormatter, value);
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

/** Format a Tokyo calendar date without interpreting date-only input in the host timezone. */
export function formatTokyoCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid Tokyo calendar date: ${value}`);
  const [, year, month, day] = match;
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = tokyoWeekdayFormatter.format(date);
  return `${Number(year)}年${Number(month)}月${Number(day)}日（${weekday}）`;
}

export function getTokyoMonth(value: DateTimeInput): string {
  const parts = getParts(tokyoMonthPartsFormatter, value);
  return `${parts.year.padStart(4, "0")}-${parts.month}`;
}

export function toTokyoDateTimeLocal(value: DateTimeInput): string {
  const parts = getParts(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TOKYO_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    value,
  );
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function getMillisecondsUntilNextTokyoMidnight(
  now = new Date(),
): number {
  const [year, month, day] = getTokyoDate(now).split("-").map(Number);
  const nextDate = new Date(0);
  nextDate.setUTCFullYear(year, month - 1, day + 1);
  nextDate.setUTCHours(0, 0, 0, 0);
  const nextTokyoMidnight = nextDate.getTime() - 9 * 60 * 60 * 1000;
  return nextTokyoMidnight - now.getTime();
}

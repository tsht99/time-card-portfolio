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

function toDate(value: DateTimeInput) {
  return value instanceof Date ? value : new Date(value);
}

export function formatTokyoTime(value: DateTimeInput) {
  return tokyoTimeFormatter.format(toDate(value));
}

export function formatTokyoDateTime(value: DateTimeInput) {
  return tokyoDateTimeFormatter.format(toDate(value));
}

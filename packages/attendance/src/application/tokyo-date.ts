export function getTokyoDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function getTokyoMonthRange(yearMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) throw new Error(`Invalid year-month: ${yearMonth}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${yearMonth}`);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const startAt = new Date(`${yearMonth}-01T00:00:00+09:00`);
  const endExclusiveAt = new Date(
    `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`,
  );
  return { startAt, endExclusiveAt };
}

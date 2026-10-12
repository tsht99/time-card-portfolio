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
  const match = /^(?!0000)(\d{4})-(0[1-9]|1[0-2])$/.exec(yearMonth);
  if (!match) throw new Error(`Invalid year-month: ${yearMonth}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year === 9999 && month === 12) {
    throw new Error(`Invalid year-month: ${yearMonth}`);
  }
  const makeTokyoMonthStart = (targetYear: number, targetMonth: number) => {
    const date = new Date(0);
    date.setUTCFullYear(targetYear, targetMonth - 1, 1);
    date.setUTCHours(-9, 0, 0, 0);
    return date;
  };
  const startAt = makeTokyoMonthStart(year, month);
  const endExclusiveAt = makeTokyoMonthStart(year, month + 1);
  if (
    !Number.isFinite(startAt.getTime()) ||
    !Number.isFinite(endExclusiveAt.getTime()) ||
    startAt >= endExclusiveAt
  ) {
    throw new Error(`Invalid year-month range: ${yearMonth}`);
  }
  return { startAt, endExclusiveAt };
}

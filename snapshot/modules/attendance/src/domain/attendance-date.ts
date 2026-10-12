class InvalidAttendanceDateTimeError extends Error {
  constructor(field: string) {
    super(`Attendance ${field} must be a valid Date.`);
    this.name = "InvalidAttendanceDateTimeError";
  }
}

export function assertValidAttendanceDateTime(date: Date, field: string): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new InvalidAttendanceDateTimeError(field);
  }
}

const jstDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function deriveAttendanceDateFromClockInAt(clockInAt: Date): string {
  assertValidAttendanceDateTime(clockInAt, "clockInAt");

  const dateParts = Object.fromEntries(
    jstDateFormatter
      .formatToParts(clockInAt)
      .filter(
        ({ type }) => type === "year" || type === "month" || type === "day",
      )
      .map(({ type, value }) => [type, value]),
  );

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

const safeUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSafeAttendanceId(value: unknown): value is string {
  return typeof value === "string" && safeUuid.test(value);
}

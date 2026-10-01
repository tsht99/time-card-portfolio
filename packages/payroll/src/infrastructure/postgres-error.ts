export function hasDatabaseErrorCode(
  error: unknown,
  expectedCode: string,
): boolean {
  const visited = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === expectedCode) return true;
    current = record.cause;
  }
  return false;
}

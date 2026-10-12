import type { EventEmitter } from "node:events";

type DatabaseDriver = "neon-serverless" | "node-postgres";

type PoolError = {
  code?: unknown;
};

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;

  const { code } = error as PoolError;
  return typeof code === "string" && /^[A-Z0-9][A-Z0-9_]{0,31}$/.test(code)
    ? code
    : undefined;
}

export function listenForPoolErrors(
  pool: EventEmitter,
  driver: DatabaseDriver,
): void {
  pool.on("error", (error: unknown) => {
    const code = safeErrorCode(error);
    console.error("Database connection pool emitted an error", {
      driver,
      ...(code === undefined ? {} : { code }),
    });
  });
}

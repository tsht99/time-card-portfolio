import type { EventEmitter } from "node:events";

import { listenForPoolErrors } from "./pool-error-handler.ts";

const DATABASE_CONNECTION_TIMEOUT_MILLIS = 10_000;

type PoolOptions = {
  connectionString: string;
  connectionTimeoutMillis: number;
};

export function createMonitoredPool<Pool extends EventEmitter>(
  PoolConstructor: new (options: PoolOptions) => Pool,
  databaseUrl: string,
  driver: "neon-serverless" | "node-postgres",
): Pool {
  const pool = new PoolConstructor({
    connectionString: databaseUrl,
    connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MILLIS,
  });
  listenForPoolErrors(pool, driver);
  return pool;
}

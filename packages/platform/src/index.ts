import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type PostgresDatabase = PgDatabase<
  PgQueryResultHKT,
  Record<string, unknown>
>;

export { normalizePostgresConnectionString } from "./connection-string.ts";
export { createDatabaseFactory } from "./database-factory.ts";

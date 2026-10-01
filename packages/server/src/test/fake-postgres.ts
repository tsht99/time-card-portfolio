import type { PostgresDatabase } from "@repo/platform";

// Small tests only build the route tree and do not execute database queries.
export const fakePostgresDatabase = {} as PostgresDatabase;

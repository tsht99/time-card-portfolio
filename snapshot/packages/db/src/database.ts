import { Pool as NeonPool } from "@neondatabase/serverless";
import { createDatabaseFactory, type PostgresDatabase } from "@repo/postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool as NodePostgresPool } from "pg";

import { createMonitoredPool } from "./connection-pool.ts";
import * as schema from "./schema.ts";

export const getDatabase = createDatabaseFactory({
  createNeonDatabase: (databaseUrl) => {
    const pool = createMonitoredPool(NeonPool, databaseUrl, "neon-serverless");
    return drizzleNeon(pool, { schema }) as PostgresDatabase;
  },
  createNodePostgresDatabase: (databaseUrl) => {
    const pool = createMonitoredPool(
      NodePostgresPool,
      databaseUrl,
      "node-postgres",
    );
    return drizzleNodePostgres(pool, { schema }) as PostgresDatabase;
  },
});

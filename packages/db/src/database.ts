import { Pool as NeonPool } from "@neondatabase/serverless";
import { createDatabaseFactory, type PostgresDatabase } from "@repo/platform";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool as NodePostgresPool } from "pg";

import * as schema from "./schema/index.ts";

export const getDatabase = createDatabaseFactory({
  createNeonDatabase: (databaseUrl) =>
    drizzleNeon(new NeonPool({ connectionString: databaseUrl }), {
      schema,
    }) as PostgresDatabase,
  createNodePostgresDatabase: (databaseUrl) =>
    drizzleNodePostgres(
      new NodePostgresPool({ connectionString: databaseUrl }),
      {
        schema,
      },
    ) as PostgresDatabase,
});

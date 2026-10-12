import { fileURLToPath } from "node:url";
import { startMediumPostgresTemplate } from "@repo/test-support/medium-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/db/migrations", import.meta.url),
);
let template:
  | Awaited<ReturnType<typeof startMediumPostgresTemplate>>
  | undefined;

export async function globalSetup(): Promise<void> {
  template = await startMediumPostgresTemplate({
    initialize: async (templateUrl) => {
      const pool = new Pool({ connectionString: templateUrl });
      try {
        await migrate(drizzle(pool), { migrationsFolder });
      } finally {
        await pool.end();
      }
    },
  });
}

export async function globalTeardown(): Promise<void> {
  const startedTemplate = template;
  template = undefined;
  await startedTemplate?.close();
}

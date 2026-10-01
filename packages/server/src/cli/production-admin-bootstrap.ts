import { fileURLToPath } from "node:url";

import { runProductionAdminBootstrap } from "@repo/users/infrastructure";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

import {
  parseProductionAdminBootstrapArguments,
  validateProductionAdminBootstrapEnvironment,
} from "./production-admin-bootstrap-options.ts";

function printResult(
  result: Awaited<ReturnType<typeof runProductionAdminBootstrap>>,
): void {
  console.log(JSON.stringify(result));
}

async function main(): Promise<void> {
  const options = parseProductionAdminBootstrapArguments(process.argv.slice(2));
  const database = validateProductionAdminBootstrapEnvironment(options);
  const pool = new Pool({ connectionString: database.connectionString });
  try {
    const client: PoolClient = await pool.connect();
    const db = drizzle(client);
    printResult(
      await runProductionAdminBootstrap(client, db, database.identity, options),
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch(() => {
    console.error("Production admin bootstrap failed.");
    process.exitCode = 1;
  });
}

import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import {
  assertConnectedMaintenanceDatabase,
  resolveMaintenanceConnection,
} from "./maintenance-connection.ts";
import {
  type MigrationMode,
  validateMigrationContext,
} from "./migration-context.ts";

const ADVISORY_LOCK_KEY = "704136260036";

export async function runMigrations(
  mode: MigrationMode,
  env = process.env,
): Promise<void> {
  const context = validateMigrationContext(mode, env);
  const maintenanceConnection = resolveMaintenanceConnection(
    context.environment,
    env,
  );

  const pool = new Pool({
    connectionString: maintenanceConnection.connectionString,
  });
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    await pool.end();
    throw error;
  }
  const db = drizzle(client);
  let locked = false;
  try {
    await assertConnectedMaintenanceDatabase(
      client,
      maintenanceConnection.identity,
    );
    await client.query("select pg_advisory_lock($1::bigint)", [
      ADVISORY_LOCK_KEY,
    ]);
    locked = true;
    await drizzleMigrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations", import.meta.url),
      ),
    });
  } finally {
    try {
      if (locked)
        await client.query("select pg_advisory_unlock($1::bigint)", [
          ADVISORY_LOCK_KEY,
        ]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

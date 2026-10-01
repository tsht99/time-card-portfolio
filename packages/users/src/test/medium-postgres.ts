import type { PostgresDatabase } from "@repo/platform";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../schema/index.ts";

const TEMPLATE_URL_ENV = "TIME_CARD_MEDIUM_POSTGRES_TEMPLATE_URL";
let databaseCounter = 0;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function maintenanceConnectionString(templateUrl: string): string {
  const url = new URL(templateUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function databaseConnectionString(
  templateUrl: string,
  databaseName: string,
): string {
  const url = new URL(templateUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function dropTestDatabase(
  maintenanceUrl: string,
  databaseName: string,
): Promise<void> {
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    await pool.query(`DROP DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await pool.end();
  }
}

export async function startMediumTestDatabase() {
  const templateUrl = process.env[TEMPLATE_URL_ENV];
  if (templateUrl === undefined) {
    throw new Error(
      `${TEMPLATE_URL_ENV} is not set. Start server medium tests with the global setup.`,
    );
  }

  const databaseName = `timecard_medium_${process.pid}_${++databaseCounter}`;
  const templateDatabaseName = decodeURIComponent(
    new URL(templateUrl).pathname.slice(1),
  );
  const maintenanceUrl = maintenanceConnectionString(templateUrl);
  let databaseCreated = false;
  let pool: Pool | undefined;

  try {
    const maintenancePool = new Pool({ connectionString: maintenanceUrl });
    try {
      await maintenancePool.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE ${quoteIdentifier(templateDatabaseName)}`,
      );
      databaseCreated = true;
    } finally {
      await maintenancePool.end();
    }

    const testPool = new Pool({
      connectionString: databaseConnectionString(templateUrl, databaseName),
    });
    pool = testPool;
    const db = drizzle(testPool, { schema }) satisfies PostgresDatabase;
    let closed = false;

    return {
      db,
      pool,
      async close() {
        if (closed) {
          return;
        }
        closed = true;

        try {
          await testPool.end();
        } finally {
          await dropTestDatabase(maintenanceUrl, databaseName);
        }
      },
    };
  } catch (error) {
    await pool?.end().catch(() => undefined);
    if (databaseCreated) {
      await dropTestDatabase(maintenanceUrl, databaseName).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

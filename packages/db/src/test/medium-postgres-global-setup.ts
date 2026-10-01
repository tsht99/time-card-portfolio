import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  assertPostgres18Version,
  createMediumTemplateDatabaseName,
  databaseUrl,
  EXTERNAL_POSTGRES_URL_ENV,
  MEDIUM_TEMPLATE_DATABASE,
  MEDIUM_TEMPLATE_URL_ENV,
  parseExternalMaintenanceUrl,
  quoteDatabaseIdentifier,
} from "./medium-postgres-config.ts";

const migrationsFolder = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);
let container: StartedPostgreSqlContainer | undefined;
let externalMaintenanceUrl: string | undefined;
let externalTemplateCreated = false;
let externalTemplateDatabaseName: string | undefined;

async function removeExternalTemplate(): Promise<void> {
  if (
    !externalTemplateCreated ||
    externalMaintenanceUrl === undefined ||
    externalTemplateDatabaseName === undefined
  )
    return;
  const pool = new Pool({ connectionString: externalMaintenanceUrl });
  try {
    await pool.query(
      `DROP DATABASE ${quoteDatabaseIdentifier(externalTemplateDatabaseName)}`,
    );
    externalTemplateCreated = false;
  } finally {
    await pool.end();
  }
}

export async function globalSetup(): Promise<void> {
  let migrationPool: Pool | undefined;
  let maintenancePool: Pool | undefined;
  try {
    const configuredUrl = process.env[EXTERNAL_POSTGRES_URL_ENV];
    let templateUrl: string;
    let templateDatabaseName = MEDIUM_TEMPLATE_DATABASE;
    if (configuredUrl !== undefined) {
      const maintenanceUrl =
        parseExternalMaintenanceUrl(configuredUrl).toString();
      externalMaintenanceUrl = maintenanceUrl;
      maintenancePool = new Pool({ connectionString: maintenanceUrl });
      const version = await maintenancePool.query<{
        server_version_num: string;
      }>("select current_setting('server_version_num') as server_version_num");
      assertPostgres18Version(version.rows[0]?.server_version_num ?? "");
      templateDatabaseName = createMediumTemplateDatabaseName();
      externalTemplateDatabaseName = templateDatabaseName;
      await maintenancePool.query(
        `CREATE DATABASE ${quoteDatabaseIdentifier(templateDatabaseName)}`,
      );
      externalTemplateCreated = true;
      templateUrl = databaseUrl(maintenanceUrl, templateDatabaseName);
    } else {
      container = await new PostgreSqlContainer("postgres:18-alpine")
        .withDatabase(MEDIUM_TEMPLATE_DATABASE)
        .start();
      templateUrl = container.getConnectionUri();
    }

    migrationPool = new Pool({ connectionString: templateUrl });
    await migrate(drizzle(migrationPool), { migrationsFolder });
    await migrationPool.end();
    migrationPool = undefined;
    await maintenancePool?.end();
    maintenancePool = undefined;
    process.env[MEDIUM_TEMPLATE_URL_ENV] = templateUrl;
  } catch (error) {
    await migrationPool?.end().catch(() => undefined);
    await maintenancePool?.end().catch(() => undefined);
    await removeExternalTemplate().catch(() => undefined);
    await container?.stop().catch(() => undefined);
    container = undefined;
    externalMaintenanceUrl = undefined;
    externalTemplateDatabaseName = undefined;
    delete process.env[MEDIUM_TEMPLATE_URL_ENV];
    throw error;
  }
}

export async function globalTeardown(): Promise<void> {
  delete process.env[MEDIUM_TEMPLATE_URL_ENV];
  await removeExternalTemplate();
  const startedContainer = container;
  container = undefined;
  await startedContainer?.stop();
  externalMaintenanceUrl = undefined;
  externalTemplateDatabaseName = undefined;
}

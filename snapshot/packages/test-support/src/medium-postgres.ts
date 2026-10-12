import { randomUUID } from "node:crypto";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const EXTERNAL_POSTGRES_URL_ENV = "TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL";
export const MEDIUM_TEMPLATE_URL_ENV = "TIME_CARD_MEDIUM_POSTGRES_TEMPLATE_URL";
const MEDIUM_TEMPLATE_DATABASE = "timecard_medium_template";

export function parseExternalMaintenanceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must be a valid PostgreSQL URL`,
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must use postgres or postgresql`,
    );
  }
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]"
  ) {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must target a localhost loopback address`,
    );
  }
  if (url.pathname !== "/postgres") {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must connect to the postgres maintenance database`,
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must not include query parameters or a fragment`,
    );
  }
  return url;
}

export function assertPostgres18Version(serverVersionNum: string): void {
  if (!serverVersionNum.startsWith("18")) {
    throw new Error("External test PostgreSQL server must be major version 18");
  }
}

export function databaseUrl(
  baseUrl: string | URL,
  databaseName: string,
): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function databaseNameFromUrl(databaseUrlValue: string | URL): string {
  const name = decodeURIComponent(new URL(databaseUrlValue).pathname.slice(1));
  if (name.length === 0) {
    throw new Error("PostgreSQL URL must include a database name");
  }
  return name;
}

export function quoteDatabaseIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function createMediumDatabaseName(prefix = "timecard_medium"): string {
  return `${prefix}_${process.pid}_${randomUUID().replaceAll("-", "")}`;
}

async function assertPostgres18(pool: Pool): Promise<void> {
  const result = await pool.query<{ server_version_num: string }>(
    "select current_setting('server_version_num') as server_version_num",
  );
  assertPostgres18Version(result.rows[0]?.server_version_num ?? "");
}

type TemplateOptions = {
  initialize?: (templateUrl: string) => Promise<void>;
  maintenanceUrl?: string;
};

type MediumPostgresTemplate = {
  templateUrl: string;
  close: () => Promise<void>;
};

/** Starts a PG18 template DB, runs caller-owned setup, and owns its cleanup. */
export async function startMediumPostgresTemplate(
  options: TemplateOptions = {},
): Promise<MediumPostgresTemplate> {
  const previousTemplateUrl = process.env[MEDIUM_TEMPLATE_URL_ENV];
  let container: StartedPostgreSqlContainer | undefined;
  let maintenanceUrl: string | undefined;
  let externalTemplateName: string | undefined;
  let externalTemplateCreated = false;
  let templateUrl = "";
  let closed = false;

  const close = async () => {
    if (closed) return;
    try {
      if (
        externalTemplateCreated &&
        maintenanceUrl !== undefined &&
        externalTemplateName !== undefined
      ) {
        const pool = new Pool({ connectionString: maintenanceUrl });
        try {
          await pool.query(
            `DROP DATABASE ${quoteDatabaseIdentifier(externalTemplateName)} WITH (FORCE)`,
          );
        } finally {
          await pool.end();
        }
      }
    } finally {
      await container?.stop();
      container = undefined;
      if (process.env[MEDIUM_TEMPLATE_URL_ENV] === templateUrl) {
        if (previousTemplateUrl === undefined) {
          delete process.env[MEDIUM_TEMPLATE_URL_ENV];
        } else {
          process.env[MEDIUM_TEMPLATE_URL_ENV] = previousTemplateUrl;
        }
      }
    }
    closed = true;
  };

  try {
    const configuredMaintenanceUrl =
      options.maintenanceUrl ?? process.env[EXTERNAL_POSTGRES_URL_ENV];
    if (configuredMaintenanceUrl !== undefined) {
      maintenanceUrl = parseExternalMaintenanceUrl(
        configuredMaintenanceUrl,
      ).toString();
      const pool = new Pool({ connectionString: maintenanceUrl });
      try {
        await assertPostgres18(pool);
        externalTemplateName = createMediumDatabaseName(
          MEDIUM_TEMPLATE_DATABASE,
        );
        await pool.query(
          `CREATE DATABASE ${quoteDatabaseIdentifier(externalTemplateName)}`,
        );
        externalTemplateCreated = true;
      } finally {
        await pool.end();
      }
      templateUrl = databaseUrl(maintenanceUrl, externalTemplateName);
    } else {
      container = await new PostgreSqlContainer("postgres:18-alpine")
        .withDatabase(MEDIUM_TEMPLATE_DATABASE)
        .start();
      templateUrl = container.getConnectionUri();
    }

    await options.initialize?.(templateUrl);
    process.env[MEDIUM_TEMPLATE_URL_ENV] = templateUrl;
    return { templateUrl, close };
  } catch (error) {
    if (previousTemplateUrl === undefined) {
      delete process.env[MEDIUM_TEMPLATE_URL_ENV];
    } else {
      process.env[MEDIUM_TEMPLATE_URL_ENV] = previousTemplateUrl;
    }
    await close().catch(() => undefined);
    throw error;
  }
}

type MediumTestDatabase<TSchema extends Record<string, unknown>> = {
  db: NodePgDatabase<TSchema>;
  pool: Pool;
  databaseName: string;
  close: () => Promise<void>;
};

/** Creates a disposable database cloned from the current template URL. */
export async function startMediumTestDatabase<
  TSchema extends Record<string, unknown>,
>(options: {
  schema: TSchema;
  templateUrl?: string;
}): Promise<MediumTestDatabase<TSchema>> {
  const templateUrl =
    options.templateUrl ?? process.env[MEDIUM_TEMPLATE_URL_ENV];
  if (templateUrl === undefined) {
    throw new Error(
      `${MEDIUM_TEMPLATE_URL_ENV} is not set. Start medium tests with the global setup.`,
    );
  }

  const templateDatabaseName = databaseNameFromUrl(templateUrl);
  const maintenanceUrl = databaseUrl(templateUrl, "postgres");
  const databaseName = createMediumDatabaseName();
  let databaseCreated = false;
  let pool: Pool | undefined;

  try {
    await createDatabase(maintenanceUrl, databaseName, templateDatabaseName);
    databaseCreated = true;

    pool = new Pool({
      connectionString: databaseUrl(templateUrl, databaseName),
    });
    const db = drizzle(pool, { schema: options.schema });
    let closed = false;
    const testPool = pool;
    return {
      db,
      pool: testPool,
      databaseName,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await testPool.end();
        } finally {
          await dropDatabase(maintenanceUrl, databaseName);
        }
      },
    };
  } catch (error) {
    await pool?.end().catch(() => undefined);
    if (databaseCreated) {
      await dropDatabase(maintenanceUrl, databaseName).catch(() => undefined);
    }
    throw error;
  }
}

async function dropDatabase(
  maintenanceUrl: string,
  databaseName: string,
): Promise<void> {
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    await pool.query(
      `DROP DATABASE ${quoteDatabaseIdentifier(databaseName)} WITH (FORCE)`,
    );
  } finally {
    await pool.end();
  }
}

/** Creates and owns an empty database for migration or integration tests. */
export async function startMediumPostgresDatabase(
  options: { maintenanceUrl?: string; databaseName?: string } = {},
): Promise<{
  databaseUrl: string;
  databaseName: string;
  pool: Pool;
  close: () => Promise<void>;
}> {
  const templateUrl = process.env[MEDIUM_TEMPLATE_URL_ENV];
  const configuredMaintenanceUrl =
    options.maintenanceUrl ??
    (templateUrl === undefined
      ? process.env[EXTERNAL_POSTGRES_URL_ENV]
      : databaseUrl(templateUrl, "postgres"));
  if (configuredMaintenanceUrl === undefined) {
    throw new Error(
      `A PostgreSQL maintenance URL is required to create a medium test database`,
    );
  }
  const maintenanceUrl = parseExternalMaintenanceUrl(
    configuredMaintenanceUrl,
  ).toString();
  const databaseName = options.databaseName ?? createMediumDatabaseName();
  const createdDatabaseUrl = databaseUrl(maintenanceUrl, databaseName);
  let databaseCreated = false;
  let pool: Pool | undefined;
  try {
    await createDatabase(maintenanceUrl, databaseName);
    databaseCreated = true;
    pool = new Pool({ connectionString: createdDatabaseUrl });
    const databasePool = pool;
    let closed = false;
    return {
      databaseUrl: createdDatabaseUrl,
      databaseName,
      pool: databasePool,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await databasePool.end();
        } finally {
          await dropDatabase(maintenanceUrl, databaseName);
        }
      },
    };
  } catch (error) {
    await pool?.end().catch(() => undefined);
    if (databaseCreated) {
      await dropDatabase(maintenanceUrl, databaseName).catch(() => undefined);
    }
    throw error;
  }
}

async function createDatabase(
  maintenanceUrl: string,
  databaseName: string,
  templateDatabaseName?: string,
): Promise<void> {
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    await assertPostgres18(pool);
    await pool.query(
      templateDatabaseName === undefined
        ? `CREATE DATABASE ${quoteDatabaseIdentifier(databaseName)}`
        : `CREATE DATABASE ${quoteDatabaseIdentifier(databaseName)} TEMPLATE ${quoteDatabaseIdentifier(templateDatabaseName)}`,
    );
  } finally {
    await pool.end();
  }
}

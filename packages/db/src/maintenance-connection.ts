import { normalizePostgresConnectionString } from "@repo/platform";
import type { PoolClient } from "pg";

// cspell:ignore UNPOOLED pooler

export type MaintenanceEnvironment = "local" | "preview" | "production";

export type MaintenanceDatabaseIdentity = {
  host: string;
  database: string;
};

export type MaintenanceConnection = {
  connectionString: string;
  identity: MaintenanceDatabaseIdentity;
};

function isPooledNeonHostname(hostname: string): boolean {
  const endpointLabel = hostname.split(".")[0];
  return (
    endpointLabel?.endsWith("-pooler") === true &&
    hostname.endsWith(".neon.tech")
  );
}

function requireConnectionString(
  environment: MaintenanceEnvironment,
  env: NodeJS.ProcessEnv,
): { name: "DATABASE_URL" | "DATABASE_URL_UNPOOLED"; value: string } {
  if (environment === "local") {
    const value = env.DATABASE_URL;
    if (!value) throw new Error("DATABASE_URL is not set.");
    return { name: "DATABASE_URL", value };
  }

  const value = env.DATABASE_URL_UNPOOLED;
  if (!value) throw new Error("DATABASE_URL_UNPOOLED is not set.");
  return { name: "DATABASE_URL_UNPOOLED", value };
}

function requireExpectedIdentity(
  env: NodeJS.ProcessEnv,
): MaintenanceDatabaseIdentity {
  const host = env.DATABASE_MAINTENANCE_EXPECTED_HOST;
  if (!host) {
    throw new Error("DATABASE_MAINTENANCE_EXPECTED_HOST is not set.");
  }

  const database = env.DATABASE_MAINTENANCE_EXPECTED_DATABASE;
  if (!database) {
    throw new Error("DATABASE_MAINTENANCE_EXPECTED_DATABASE is not set.");
  }

  if (isPooledNeonHostname(host)) {
    throw new Error("DATABASE_MAINTENANCE_EXPECTED_HOST must be direct.");
  }

  return { host, database };
}

export function resolveMaintenanceConnection(
  environment: MaintenanceEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): MaintenanceConnection {
  if (
    environment !== "local" &&
    environment !== "preview" &&
    environment !== "production"
  ) {
    throw new Error("Unsupported maintenance database environment.");
  }

  const source = requireConnectionString(environment, env);
  const expectedIdentity =
    environment === "local" ? undefined : requireExpectedIdentity(env);

  let url: URL;
  let database: string;
  try {
    url = new URL(source.value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error();
    }
    database = decodeURIComponent(url.pathname.slice(1));
    if (!url.hostname || !database) throw new Error();
  } catch {
    throw new Error(`${source.name} is invalid.`);
  }

  if (isPooledNeonHostname(url.hostname)) {
    throw new Error(`${source.name} must use a direct Neon hostname.`);
  }

  const identity = { host: url.hostname, database };
  if (expectedIdentity !== undefined) {
    if (identity.host !== expectedIdentity.host) {
      throw new Error(
        `${source.name} hostname does not match the expected host.`,
      );
    }
    if (identity.database !== expectedIdentity.database) {
      throw new Error(
        `${source.name} database name does not match the expected database.`,
      );
    }
  }

  let connectionString: string;
  try {
    connectionString = normalizePostgresConnectionString(source.value);
  } catch {
    throw new Error(`${source.name} is invalid.`);
  }

  return { connectionString, identity };
}

export async function assertConnectedMaintenanceDatabase(
  client: Pick<PoolClient, "query">,
  identity: MaintenanceDatabaseIdentity,
): Promise<void> {
  const result = await client.query<{ database_name: string }>(
    "select current_database() as database_name",
  );
  if (result.rows[0]?.database_name !== identity.database) {
    throw new Error("Connected database does not match the expected database.");
  }
}

import { normalizePostgresConnectionString } from "./connection-string.ts";
import type { PostgresDatabase } from "./index.ts";

type DatabaseEnvironment = "local" | "preview" | "production";
type DatabaseDriver = "node-postgres" | "neon-serverless";

type DatabaseFactoryDependencies = {
  createNeonDatabase: (databaseUrl: string) => PostgresDatabase;
  createNodePostgresDatabase: (databaseUrl: string) => PostgresDatabase;
};

function requireDatabaseEnvironment(
  environment: string | undefined,
): DatabaseEnvironment {
  if (
    environment === "local" ||
    environment === "preview" ||
    environment === "production"
  )
    return environment;
  if (environment === undefined || environment === "")
    throw new Error("DATABASE_ENVIRONMENT is not set.");
  throw new Error("DATABASE_ENVIRONMENT is unsupported.");
}

function requireDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  return normalizePostgresConnectionString(databaseUrl);
}

function databaseDriverFor(environment: DatabaseEnvironment): DatabaseDriver {
  return environment === "local" ? "node-postgres" : "neon-serverless";
}

export function createDatabaseFactory(
  dependencies: DatabaseFactoryDependencies,
) {
  const cache = new Map<string, PostgresDatabase>();
  return (
    databaseUrl = process.env.DATABASE_URL,
    environment = process.env.DATABASE_ENVIRONMENT,
  ): PostgresDatabase => {
    const resolvedEnvironment = requireDatabaseEnvironment(environment);
    const normalizedUrl = requireDatabaseUrl(databaseUrl);
    const key = `${resolvedEnvironment}\0${normalizedUrl}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const database =
      databaseDriverFor(resolvedEnvironment) === "node-postgres"
        ? dependencies.createNodePostgresDatabase(normalizedUrl)
        : dependencies.createNeonDatabase(normalizedUrl);
    cache.set(key, database);
    return database;
  };
}

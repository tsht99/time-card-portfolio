import { normalizePostgresConnectionString } from "@repo/db";
import type {
  ProductionAdminBootstrapDatabaseIdentity,
  ProductionAdminBootstrapOptions,
} from "@repo/users/infrastructure";

type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

type ProductionAdminBootstrapCliOptions = ProductionAdminBootstrapOptions & {
  expectedHost: string;
  expectedDatabase: string;
};

type ParsedProductionDatabaseUrl = {
  connectionString: string;
  identity: ProductionAdminBootstrapDatabaseIdentity;
};

function requireOptionValue(option: string, value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new Error(`${option} is required.`);
  }
  return value;
}

function parseOptionValue(
  argument: string,
  option: string,
): string | undefined {
  const prefix = `${option}=`;
  return argument.startsWith(prefix)
    ? argument.slice(prefix.length)
    : undefined;
}

export function parseProductionAdminBootstrapArguments(
  argv: readonly string[],
): ProductionAdminBootstrapCliOptions {
  let expectedHost: string | undefined;
  let expectedDatabase: string | undefined;
  let lineUserId: string | undefined;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--help") {
      throw new Error(
        "Usage: production-admin-bootstrap --expected-host <host> --expected-database <database> --line-user-id <id> [--apply]",
      );
    }

    const option = [
      "--expected-host",
      "--expected-database",
      "--line-user-id",
    ].find(
      (candidate) =>
        argument === candidate || argument.startsWith(`${candidate}=`),
    );
    if (option === undefined) {
      throw new Error("Unknown production admin bootstrap argument.");
    }

    const inlineValue = parseOptionValue(argument, option);
    let value = inlineValue;
    if (value === undefined) {
      const nextArgument = argv[index + 1];
      if (nextArgument === undefined || nextArgument.startsWith("--")) {
        throw new Error(`${option} is required.`);
      }
      index += 1;
      value = requireOptionValue(option, nextArgument);
    }
    if (option === "--expected-host") expectedHost = value;
    if (option === "--expected-database") expectedDatabase = value;
    if (option === "--line-user-id") lineUserId = value;
  }

  return {
    expectedHost: requireOptionValue("--expected-host", expectedHost),
    expectedDatabase: requireOptionValue(
      "--expected-database",
      expectedDatabase,
    ),
    lineUserId: requireOptionValue("--line-user-id", lineUserId),
    apply,
  };
}

function parseProductionDatabaseUrl(
  databaseUrl: string | undefined,
  options: Pick<
    ProductionAdminBootstrapCliOptions,
    "expectedHost" | "expectedDatabase"
  >,
): ParsedProductionDatabaseUrl {
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is not set.");
  }

  let url: URL;
  let databaseName: string;
  try {
    url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error();
    }
    databaseName = decodeURIComponent(url.pathname.slice(1));
    if (!url.hostname || !databaseName) throw new Error();
  } catch {
    throw new Error("DATABASE_URL is invalid.");
  }

  if (url.hostname !== options.expectedHost) {
    throw new Error("DATABASE_URL hostname does not match the expected host.");
  }
  if (databaseName !== options.expectedDatabase) {
    throw new Error(
      "DATABASE_URL database name does not match the expected database.",
    );
  }

  return {
    connectionString: normalizePostgresConnectionString(databaseUrl),
    identity: { host: url.hostname, database: databaseName },
  };
}

export function validateProductionAdminBootstrapEnvironment(
  options: ProductionAdminBootstrapCliOptions,
  env: ProcessEnvironment = process.env,
): ParsedProductionDatabaseUrl {
  if (env.DATABASE_ENVIRONMENT !== "production") {
    throw new Error("DATABASE_ENVIRONMENT must be production.");
  }
  return parseProductionDatabaseUrl(env.DATABASE_URL, options);
}

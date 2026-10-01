import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as schema from "@repo/db";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const stateDirectory = fileURLToPath(new URL("../.e2e", import.meta.url));
const stateFile = fileURLToPath(
  new URL("../.e2e/database.json", import.meta.url),
);
const migrationsFolder = fileURLToPath(
  new URL("../../../packages/db/migrations", import.meta.url),
);
const webRuntime = process.env.E2E_WEB_RUNTIME ?? "production";
const externalPostgresUrlEnv = "TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL";

function parseExternalMaintenanceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${externalPostgresUrlEnv} must be a valid PostgreSQL URL`);
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `${externalPostgresUrlEnv} must use postgres or postgresql`,
    );
  }
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]"
  ) {
    throw new Error(`${externalPostgresUrlEnv} must target localhost loopback`);
  }
  if (url.pathname !== "/postgres") {
    throw new Error(`${externalPostgresUrlEnv} must connect to postgres`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(
      `${externalPostgresUrlEnv} must not include query or fragment`,
    );
  }
  return url;
}

function quoteDatabaseIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrl(baseUrl: string | URL, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function stopChild(child: ReturnType<typeof spawn> | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>((resolve) => {
    child.once("exit", resolve);
  });
  const waitForExit = async (timeoutMs: number) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    return child.exitCode !== null || child.signalCode !== null;
  };

  child.kill("SIGTERM");
  if (await waitForExit(5_000)) return;

  child.kill("SIGKILL");
  if (!(await waitForExit(1_000))) {
    throw new Error("E2E webserver child did not exit after SIGKILL");
  }
}

async function main() {
  await rm(stateDirectory, { recursive: true, force: true });
  await mkdir(stateDirectory, { recursive: true });

  let container: StartedPostgreSqlContainer | undefined;
  const configuredExternalUrl = process.env[externalPostgresUrlEnv];
  let maintenanceUrl: string | undefined;
  let externalDatabaseName: string | undefined;
  let externalDatabaseCreated = false;
  let databaseUrlValue: string;
  let pool: Pool | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let closed = false;

  const cleanupExternalDatabase = async () => {
    if (!externalDatabaseCreated || !maintenanceUrl || !externalDatabaseName)
      return;
    const maintenancePool = new Pool({ connectionString: maintenanceUrl });
    try {
      await maintenancePool.query(
        `DROP DATABASE IF EXISTS ${quoteDatabaseIdentifier(externalDatabaseName)} WITH (FORCE)`,
      );
      externalDatabaseCreated = false;
    } finally {
      await maintenancePool.end();
    }
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    await stopChild(child);
    await pool?.end().catch(() => undefined);
    await cleanupExternalDatabase();
    await container?.stop().catch(() => undefined);
    await rm(stateDirectory, { recursive: true, force: true });
  };
  const onSignal = () => {
    void close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(
          "E2E webserver shutdown cleanup failed:",
          error instanceof Error ? error.message : "unknown error",
        );
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    if (configuredExternalUrl !== undefined) {
      maintenanceUrl = parseExternalMaintenanceUrl(
        configuredExternalUrl,
      ).toString();
      const maintenancePool = new Pool({ connectionString: maintenanceUrl });
      try {
        const version = await maintenancePool.query<{
          server_version_num: string;
        }>(
          "select current_setting('server_version_num') as server_version_num",
        );
        if (!(version.rows[0]?.server_version_num ?? "").startsWith("18")) {
          throw new Error(
            "External test PostgreSQL server must be major version 18",
          );
        }
        externalDatabaseName = `timecard_e2e_${process.pid}_${randomUUID().replaceAll("-", "")}`;
        await maintenancePool.query(
          `CREATE DATABASE ${quoteDatabaseIdentifier(externalDatabaseName)}`,
        );
        externalDatabaseCreated = true;
      } finally {
        await maintenancePool.end();
      }
      databaseUrlValue = databaseUrl(maintenanceUrl, externalDatabaseName);
    } else {
      container = await new PostgreSqlContainer("postgres:18-alpine").start();
      databaseUrlValue = container.getConnectionUri();
    }

    pool = new Pool({ connectionString: databaseUrlValue });
    await migrate(drizzle(pool, { schema }), { migrationsFolder });
    child = spawn(
      "pnpm",
      ["--filter", "@repo/server", "projection:rebuild:local"],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrlValue,
          DATABASE_ENVIRONMENT: "local",
        },
        stdio: "inherit",
      },
    );
    const rebuildExitCode = await new Promise<number | null>(
      (resolve, reject) => {
        child?.once("error", reject);
        child?.once("exit", resolve);
      },
    );
    child = undefined;
    if (rebuildExitCode !== 0) {
      throw new Error(
        `Attendance Current State Projection rebuild exited with code ${rebuildExitCode ?? "null"}.`,
      );
    }

    await writeFile(
      stateFile,
      JSON.stringify({
        databaseUrl: databaseUrlValue,
        ...(maintenanceUrl && externalDatabaseName
          ? {
              externalPostgres: {
                maintenanceUrl,
                databaseName: externalDatabaseName,
              },
            }
          : {}),
      }),
      "utf8",
    );
    child = spawn(
      "pnpm",
      [
        "--filter",
        "web",
        "exec",
        "next",
        webRuntime === "development" ? "dev" : "start",
        ...(webRuntime === "development" ? ["--webpack"] : []),
        "--hostname",
        "127.0.0.1",
        "--port",
        "4173",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrlValue,
          DATABASE_ENVIRONMENT: "local",
        },
        stdio: "inherit",
      },
    );
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child?.once("error", reject);
      child?.once("exit", resolve);
    });
    process.exitCode = exitCode ?? 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

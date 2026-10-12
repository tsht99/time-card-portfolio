import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as schema from "@repo/db";
import {
  databaseUrl,
  startMediumPostgresDatabase,
  startMediumPostgresTemplate,
} from "@repo/test-support/medium-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const stateDirectory = fileURLToPath(
  new URL("../../.web-test", import.meta.url),
);
const stateFile = fileURLToPath(
  new URL("../../.web-test/database.json", import.meta.url),
);
const migrationsFolder = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);
const webRuntime = process.env.WEB_TEST_RUNTIME ?? "production";

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
    throw new Error("Web test server child did not exit after SIGKILL");
  }
}

async function main() {
  await rm(stateDirectory, { recursive: true, force: true });
  await mkdir(stateDirectory, { recursive: true });

  let template:
    | Awaited<ReturnType<typeof startMediumPostgresTemplate>>
    | undefined;
  let database:
    | Awaited<ReturnType<typeof startMediumPostgresDatabase>>
    | undefined;
  let databaseUrlValue: string;
  let child: ReturnType<typeof spawn> | undefined;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    await stopChild(child);
    await database?.close().catch(() => undefined);
    await template?.close().catch(() => undefined);
    await rm(stateDirectory, { recursive: true, force: true });
  };
  const onSignal = () => {
    void close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(
          "Web test server shutdown cleanup failed:",
          error instanceof Error ? error.message : "unknown error",
        );
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    template = await startMediumPostgresTemplate();
    database = await startMediumPostgresDatabase({
      maintenanceUrl: databaseUrl(template.templateUrl, "postgres"),
    });
    databaseUrlValue = database.databaseUrl;
    await migrate(drizzle(database.pool, { schema }), { migrationsFolder });
    child = spawn(
      "pnpm",
      ["--filter", "@repo/attendance-projection-rebuild", "rebuild:local"],
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

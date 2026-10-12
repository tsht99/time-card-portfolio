import { fileURLToPath } from "node:url";
import type { MigrationMode } from "./migration-context.ts";
import { runMigrations } from "./migration-runner.ts";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2] as MigrationMode | undefined;
  if (mode !== "local" && mode !== "deploy") {
    console.error("Usage: migrate.ts <local|deploy>");
    process.exitCode = 1;
  } else
    runMigrations(mode).catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : "Migration failed.",
      );
      process.exitCode = 1;
    });
}

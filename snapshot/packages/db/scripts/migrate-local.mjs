import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyLocalDatabaseConfig } from "../../../scripts/database/local-config.mjs";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function runLocalMigration(
  root = path.resolve(packageDirectory, "../.."),
  environment = process.env,
  run = spawnSync,
) {
  await applyLocalDatabaseConfig(environment, root);
  return run(
    process.execPath,
    ["--conditions=development", "--import", "tsx", "src/migrate.ts", "local"],
    { cwd: packageDirectory, env: environment, stdio: "inherit" },
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await runLocalMigration();
    if (result.error) {
      process.stderr.write(`${result.error.message}\n`);
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

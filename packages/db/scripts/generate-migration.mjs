import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE_ERROR =
  "Migration name is required. Usage: pnpm --filter @repo/db generate -- <migration-name>";
const FORMAT_ERROR =
  'Migration name must start with a lowercase letter or digit and contain only lowercase letters, digits, "_" or "-".';

export function validateMigrationName(args) {
  // pnpm forwards the `--` separator from the documented command to this script.
  const names = args[0] === "--" ? args.slice(1) : args;
  if (names.length !== 1) return { error: USAGE_ERROR };
  const [name] = names;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return { error: FORMAT_ERROR };
  return { name };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = validateMigrationName(process.argv.slice(2));
  if (result.error) {
    process.stderr.write(`${result.error}\n`);
    process.exitCode = 1;
  } else {
    const child = spawnSync(
      "drizzle-kit",
      ["generate", `--name=${result.name}`],
      { shell: false, stdio: "inherit" },
    );
    if (child.error) {
      process.stderr.write(`${child.error.message}\n`);
      process.exitCode = 1;
    } else {
      process.exitCode = child.status ?? 1;
    }
  }
}

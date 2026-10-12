import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MANAGED_ENV_FILE = resolve(REPOSITORY_ROOT, "apps/web/.env.test");

export function validateHelpUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("apps/web/.env.test must define NEXT_PUBLIC_HELP_URL");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_HELP_URL in apps/web/.env.test must be a valid URL",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      "NEXT_PUBLIC_HELP_URL in apps/web/.env.test must use HTTP or HTTPS",
    );
  }

  return value;
}

export function createValidationEnvironment(managedHelpUrl, inheritedEnv) {
  return {
    ...inheritedEnv,
    NEXT_PUBLIC_HELP_URL: validateHelpUrl(managedHelpUrl),
  };
}

export async function runPrePushValidation({
  envFilePath = MANAGED_ENV_FILE,
  inheritedEnv = process.env,
  run = spawnSync,
  readManagedEnv = readFile,
} = {}) {
  const source = await readManagedEnv(envFilePath, "utf8");
  const managedEnv = parseEnv(source);
  const env = createValidationEnvironment(
    managedEnv.NEXT_PUBLIC_HELP_URL,
    inheritedEnv,
  );
  const result = run(
    "pnpm",
    ["exec", "turbo", "run", "typecheck", "test:small"],
    {
      env,
      stdio: "inherit",
    },
  );

  if (result.error) console.error(result.error);
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runPrePushValidation().then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function validateLocalDatabaseConfig(environment) {
  const missing = ["DATABASE_URL", "DATABASE_ENVIRONMENT"].filter(
    (key) => !environment[key] || environment[key].trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `root .env.localに必要な環境変数がありません: ${missing.join(", ")}`,
    );
  }
  if (environment.DATABASE_ENVIRONMENT !== "local") {
    throw new Error("DATABASE_ENVIRONMENTはlocalである必要があります。");
  }
  try {
    const url = new URL(environment.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.pathname.slice(1)
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "DATABASE_URLは有効なPostgreSQL接続文字列である必要があります。",
    );
  }
  return { ...environment };
}

export async function readLocalDatabaseConfig(root = REPOSITORY_ROOT) {
  const contents = await readFile(path.join(root, ".env.local"), "utf8");
  return validateLocalDatabaseConfig(parseEnv(contents));
}

export async function applyLocalDatabaseConfig(
  env = process.env,
  root = REPOSITORY_ROOT,
) {
  const settings = await readLocalDatabaseConfig(root);
  // Local file values intentionally replace inherited values so a shell export
  // cannot redirect a local command to another database.
  Object.assign(env, settings);
  return settings;
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const environmentDirectory = fileURLToPath(new URL(".", import.meta.url));

export function readWebTestEnv(): Record<string, string | undefined> {
  return parseEnv(
    readFileSync(resolve(environmentDirectory, "../../.env.test"), "utf8"),
  );
}

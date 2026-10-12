import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "@repo/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const stateFile = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../.web-test/database.json",
);

export async function openTestDatabase() {
  const { databaseUrl } = JSON.parse(await readFile(stateFile, "utf8")) as {
    databaseUrl: string;
  };
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

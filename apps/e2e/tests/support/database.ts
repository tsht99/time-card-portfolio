import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as schema from "@repo/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const stateFile = resolve(process.cwd(), ".e2e/database.json");

export async function openE2eDatabase() {
  const { databaseUrl } = JSON.parse(await readFile(stateFile, "utf8")) as {
    databaseUrl: string;
  };
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

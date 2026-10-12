import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url));

test("Drizzle config is loadable without developer local settings", async () => {
  const source = await readFile(
    join(packageDirectory, "..", "drizzle.config.ts"),
    "utf8",
  );
  assert.match(source, /url:\s*process\.env\.DATABASE_URL\s*\?\?\s*["']{2}/u);
  assert.doesNotMatch(source, /\.env\.local|local-config/u);
});

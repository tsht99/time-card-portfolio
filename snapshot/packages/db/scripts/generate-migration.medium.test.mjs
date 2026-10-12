import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./generate-migration.mjs", import.meta.url),
);
const usageError =
  "Migration name is required. Usage: pnpm --filter @repo/db generate:migration -- <migration-name>";
const formatError =
  'Migration name must start with a lowercase letter or digit and contain only lowercase letters, digits, "_" or "-".';

for (const { args, error } of [
  { args: [], error: usageError },
  { args: ["--"], error: usageError },
  { args: ["BAD"], error: formatError },
  { args: ["--", "BAD"], error: formatError },
]) {
  test(`CLI rejects ${JSON.stringify(args)} before generation`, () => {
    const child = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.notEqual(child.status, 0);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, `${error}\n`);
  });
}

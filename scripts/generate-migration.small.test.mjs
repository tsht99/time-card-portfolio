import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateMigrationName } from "../packages/db/scripts/generate-migration.mjs";

const script = fileURLToPath(
  new URL("../packages/db/scripts/generate-migration.mjs", import.meta.url),
);
const usageError =
  "Migration name is required. Usage: pnpm --filter @repo/db generate -- <migration-name>";
const formatError =
  'Migration name must start with a lowercase letter or digit and contain only lowercase letters, digits, "_" or "-".';

for (const name of [
  "add_user_status",
  "add-user-status",
  "v2_attendance_index",
  "0_initial_cleanup",
]) {
  test(`accepts migration name: ${name}`, () => {
    assert.deepEqual(validateMigrationName([name]), { name });
    assert.deepEqual(validateMigrationName(["--", name]), { name });
  });
}

for (const args of [
  [],
  ["--"],
  ["first", "second"],
  ["--", "first", "second"],
]) {
  test(`requires exactly one name: ${JSON.stringify(args)}`, () => {
    assert.deepEqual(validateMigrationName(args), { error: usageError });
  });
}

for (const name of [
  "AddUserStatus",
  "_add_user_status",
  "-add-user-status",
  "add user status",
  "../add-user-status",
  "foo..bar",
  "foo;bar",
  "foo$(true)",
  "--name=add-user-status",
]) {
  test(`rejects migration name: ${name}`, () => {
    assert.deepEqual(validateMigrationName([name]), { error: formatError });
    assert.deepEqual(validateMigrationName(["--", name]), {
      error: formatError,
    });
  });
}

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

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  runMigrationGeneration,
  validateMigrationName,
} from "./generate-migration.mjs";

test("migration generation validates root local settings before starting Drizzle", async () => {
  const source = await readFile(
    new URL("./generate-migration.mjs", import.meta.url),
    "utf8",
  );
  const validation = source.indexOf(
    "await applyLocalDatabaseConfig(environment, root)",
  );
  const generator = source.indexOf('run("drizzle-kit"');

  assert.notEqual(validation, -1);
  assert.ok(generator > validation);
});

test("migration generation overrides inherited target with root settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "timecard-generate-migration-"));
  try {
    await writeFile(
      join(root, ".env.local"),
      "DATABASE_URL=postgresql://localhost:5432/timecard\nDATABASE_ENVIRONMENT=local\n",
    );
    const environment = {
      DATABASE_URL: "postgresql://production.example/production",
      DATABASE_ENVIRONMENT: "production",
    };
    let invocation;
    const result = await runMigrationGeneration("test_migration", {
      root,
      environment,
      run: (...args) => {
        invocation = args;
        return { status: 0 };
      },
    });

    assert.equal(result.status, 0);
    assert.deepEqual(invocation.slice(0, 2), [
      "drizzle-kit",
      ["generate", "--name=test_migration"],
    ]);
    assert.equal(
      invocation[2].env.DATABASE_URL,
      "postgresql://localhost:5432/timecard",
    );
    assert.equal(invocation[2].env.DATABASE_ENVIRONMENT, "local");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("migration generation does not invoke Drizzle with missing root settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "timecard-generate-migration-"));
  try {
    let invoked = false;
    await assert.rejects(
      runMigrationGeneration("test_migration", {
        root,
        environment: {},
        run: () => {
          invoked = true;
          return { status: 0 };
        },
      }),
      { code: "ENOENT" },
    );
    assert.equal(invoked, false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

const usageError =
  "Migration name is required. Usage: pnpm --filter @repo/db generate:migration -- <migration-name>";
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

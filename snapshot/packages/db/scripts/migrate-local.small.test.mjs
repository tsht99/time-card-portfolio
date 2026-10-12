import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runLocalMigration } from "./migrate-local.mjs";

const valid =
  "DATABASE_URL=postgresql://localhost:5432/timecard\nDATABASE_ENVIRONMENT=local\n";

test("local migration uses root settings before invoking the migration runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "timecard-migrate-local-"));
  try {
    await writeFile(join(root, ".env.local"), valid);
    const environment = {
      DATABASE_URL: "postgresql://preview.example/preview",
      DATABASE_ENVIRONMENT: "preview",
    };
    let invocation;
    const result = await runLocalMigration(root, environment, (...args) => {
      invocation = args;
      return { status: 0 };
    });

    assert.equal(result.status, 0);
    assert.equal(
      invocation[2].env.DATABASE_URL,
      "postgresql://localhost:5432/timecard",
    );
    assert.equal(invocation[2].env.DATABASE_ENVIRONMENT, "local");
    assert.deepEqual(invocation[1].slice(-2), ["src/migrate.ts", "local"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local migration rejects invalid root settings before invoking the runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "timecard-migrate-local-"));
  try {
    await writeFile(
      join(root, ".env.local"),
      valid.replace("=local", "=production"),
    );
    let invoked = false;
    await assert.rejects(
      runLocalMigration(root, {}, () => {
        invoked = true;
        return { status: 0 };
      }),
      /localである/u,
    );
    assert.equal(invoked, false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

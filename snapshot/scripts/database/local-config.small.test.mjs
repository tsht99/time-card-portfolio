import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyLocalDatabaseConfig,
  readLocalDatabaseConfig,
} from "./local-config.mjs";

const valid =
  "DATABASE_URL=postgresql://localhost:5432/timecard\nDATABASE_ENVIRONMENT=local\n";

async function withRoot(contents, callback) {
  const root = await mkdtemp(join(tmpdir(), "timecard-local-config-"));
  try {
    if (contents !== undefined)
      await writeFile(join(root, ".env.local"), contents);
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("local DB settings load from the explicit root file", async () => {
  await withRoot(valid, async (root) => {
    assert.deepEqual(await readLocalDatabaseConfig(root), {
      DATABASE_URL: "postgresql://localhost:5432/timecard",
      DATABASE_ENVIRONMENT: "local",
    });
  });
});

test("local DB settings reject a missing file or required setting", async () => {
  await withRoot(undefined, async (root) => {
    await assert.rejects(readLocalDatabaseConfig(root), { code: "ENOENT" });
  });
  await withRoot(
    "DATABASE_URL=postgresql://localhost/timecard\n",
    async (root) => {
      await assert.rejects(
        readLocalDatabaseConfig(root),
        /DATABASE_ENVIRONMENT/u,
      );
    },
  );
});

test("local DB settings reject invalid URL and non-local environment", async () => {
  await withRoot(
    "DATABASE_URL=https://example.com\nDATABASE_ENVIRONMENT=local\n",
    async (root) => {
      await assert.rejects(readLocalDatabaseConfig(root), /DATABASE_URL/u);
    },
  );
  await withRoot(valid.replace("=local", "=preview"), async (root) => {
    await assert.rejects(readLocalDatabaseConfig(root), /localである/u);
  });
});

test("root settings replace inherited values before a local command", async () => {
  await withRoot(valid, async (root) => {
    const environment = {
      DATABASE_URL: "postgresql://production.example/db",
      DATABASE_ENVIRONMENT: "production",
    };
    await applyLocalDatabaseConfig(environment, root);
    assert.equal(
      environment.DATABASE_URL,
      "postgresql://localhost:5432/timecard",
    );
    assert.equal(environment.DATABASE_ENVIRONMENT, "local");
  });
});

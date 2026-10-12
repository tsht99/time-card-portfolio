import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  MEDIUM_TEMPLATE_URL_ENV,
  startMediumPostgresDatabase,
  startMediumPostgresTemplate,
  startMediumTestDatabase,
} from "./medium-postgres.ts";

describe("medium PostgreSQL database lifecycle", { concurrency: false }, () => {
  let template: Awaited<ReturnType<typeof startMediumPostgresTemplate>>;
  const previousTemplateUrl = process.env[MEDIUM_TEMPLATE_URL_ENV];

  before(async () => {
    template = await startMediumPostgresTemplate({
      async initialize(templateUrl) {
        const pool = new Pool({ connectionString: templateUrl });
        try {
          await pool.query(
            "CREATE TABLE lifecycle_probe (value text NOT NULL)",
          );
          await pool.query("INSERT INTO lifecycle_probe VALUES ('template')");
        } finally {
          await pool.end();
        }
      },
    });
  });

  after(async () => {
    await template?.close();
    assert.equal(process.env[MEDIUM_TEMPLATE_URL_ENV], previousTemplateUrl);
  });

  it("clones independent databases and creates an empty disposable database", async () => {
    const first = await startMediumTestDatabase({ schema: {} });
    const second = await startMediumTestDatabase({ schema: {} });
    const empty = await startMediumPostgresDatabase();
    try {
      assert.notEqual(first.databaseName, second.databaseName);
      assert.deepEqual(
        (await first.pool.query("SELECT value FROM lifecycle_probe")).rows,
        [{ value: "template" }],
      );
      await first.pool.query(
        "INSERT INTO lifecycle_probe VALUES ('first only')",
      );
      assert.deepEqual(
        (await second.pool.query("SELECT value FROM lifecycle_probe")).rows,
        [{ value: "template" }],
      );
      assert.deepEqual(
        (
          await empty.pool.query(
            "SELECT to_regclass('public.lifecycle_probe') AS table_name",
          )
        ).rows,
        [{ table_name: null }],
      );
    } finally {
      await Promise.all([first.close(), second.close(), empty.close()]);
    }
  });

  it("publishes the template URL environment contract", () => {
    assert.equal(process.env[MEDIUM_TEMPLATE_URL_ENV], template.templateUrl);
  });
});

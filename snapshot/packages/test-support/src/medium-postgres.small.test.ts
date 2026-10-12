import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { Pool } from "pg";
import {
  assertPostgres18Version,
  createMediumDatabaseName,
  databaseNameFromUrl,
  databaseUrl,
  MEDIUM_TEMPLATE_URL_ENV,
  parseExternalMaintenanceUrl,
  quoteDatabaseIdentifier,
  startMediumPostgresDatabase,
  startMediumPostgresTemplate,
  startMediumTestDatabase,
} from "./medium-postgres.ts";

describe("medium PostgreSQL test configuration", () => {
  it("accepts loopback PostgreSQL 18 maintenance URLs", () => {
    for (const value of [
      "postgresql://user:test-only@127.0.0.1:5432/postgres",
      "postgres://user:test-only@[::1]:5432/postgres",
      "postgres://user:test-only@localhost/postgres",
    ]) {
      assert.doesNotThrow(() => parseExternalMaintenanceUrl(value));
    }
    assert.doesNotThrow(() => assertPostgres18Version("180004"));
  });

  it("rejects invalid, remote, non-maintenance, and non-18 configurations", () => {
    for (const value of [
      "not a URL",
      "http://localhost/postgres",
      "postgres://user:test-only@example.com/postgres",
      "postgres://user:test-only@10.0.0.1/postgres",
      "postgres://user:test-only@localhost/timecard",
      "postgres://user:test-only@localhost/postgres?host=remote.example",
    ]) {
      assert.throws(() => parseExternalMaintenanceUrl(value));
    }
    assert.throws(() => assertPostgres18Version("170006"), /version 18/);
  });

  it("builds database URLs and safely quotes generated identifiers", () => {
    const url = databaseUrl(
      "postgres://user:test-only@localhost/postgres",
      "timecard_medium_test",
    );
    assert.equal(databaseNameFromUrl(url), "timecard_medium_test");
    assert.equal(quoteDatabaseIdentifier('table"name'), '"table""name"');
    assert.match(
      createMediumDatabaseName(),
      /^timecard_medium_\d+_[a-f\d]{32}$/,
    );
  });

  it("fails before connecting when the required template or maintenance URL is missing", async () => {
    const previousTemplateUrl = process.env[MEDIUM_TEMPLATE_URL_ENV];
    const previousMaintenanceUrl =
      process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL;
    delete process.env[MEDIUM_TEMPLATE_URL_ENV];
    delete process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL;
    try {
      await assert.rejects(
        startMediumTestDatabase({ schema: {} }),
        new RegExp(MEDIUM_TEMPLATE_URL_ENV),
      );
      await assert.rejects(
        startMediumPostgresDatabase(),
        /maintenance URL is required/,
      );
    } finally {
      if (previousTemplateUrl === undefined) {
        delete process.env[MEDIUM_TEMPLATE_URL_ENV];
      } else {
        process.env[MEDIUM_TEMPLATE_URL_ENV] = previousTemplateUrl;
      }
      if (previousMaintenanceUrl === undefined) {
        delete process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL;
      } else {
        process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL =
          previousMaintenanceUrl;
      }
    }
  });

  it("rejects unsafe maintenance URL overrides even when a template URL exists", async () => {
    const previousTemplateUrl = process.env[MEDIUM_TEMPLATE_URL_ENV];
    process.env[MEDIUM_TEMPLATE_URL_ENV] =
      "postgres://test:test@localhost:5432/template_db";
    try {
      for (const maintenanceUrl of [
        "postgres://test:test@db.example.com/postgres",
        "postgres://test:test@localhost/timecard",
      ]) {
        await assert.rejects(
          startMediumPostgresDatabase({ maintenanceUrl }),
          /TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL/,
        );
      }
    } finally {
      if (previousTemplateUrl === undefined) {
        delete process.env[MEDIUM_TEMPLATE_URL_ENV];
      } else {
        process.env[MEDIUM_TEMPLATE_URL_ENV] = previousTemplateUrl;
      }
    }
  });

  it("drops a cloned database after its test pool closes", async () => {
    const previousTemplateUrl = process.env[MEDIUM_TEMPLATE_URL_ENV];
    const queryCalls: string[] = [];
    process.env[MEDIUM_TEMPLATE_URL_ENV] =
      "postgres://test:test@localhost:5432/template_db";
    mock.method(Pool.prototype, "query", (async (...args: unknown[]) => {
      const query = String(args[0]);
      queryCalls.push(query);
      return query.includes("server_version_num")
        ? ({ rows: [{ server_version_num: "180004" }] } as never)
        : ({ rows: [] } as never);
    }) as typeof Pool.prototype.query);
    mock.method(Pool.prototype, "end", async () => undefined);
    try {
      const database = await startMediumTestDatabase({ schema: {} });
      await database.close();
      assert.match(
        queryCalls.find((query) => query.startsWith("CREATE DATABASE")) ?? "",
        /CREATE DATABASE .* TEMPLATE "template_db"/,
      );
      assert.match(
        queryCalls.find((query) => query.startsWith("DROP DATABASE")) ?? "",
        /DROP DATABASE .* WITH \(FORCE\)/,
      );
    } finally {
      if (previousTemplateUrl === undefined) {
        delete process.env[MEDIUM_TEMPLATE_URL_ENV];
      } else {
        process.env[MEDIUM_TEMPLATE_URL_ENV] = previousTemplateUrl;
      }
    }
  });

  it("removes an external template and restores the URL after setup fails", async () => {
    const previousTemplateUrl = process.env[MEDIUM_TEMPLATE_URL_ENV];
    const previousMaintenanceUrl =
      process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL;
    const queryCalls: string[] = [];
    process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL =
      "postgres://test:test@localhost:5432/postgres";
    process.env[MEDIUM_TEMPLATE_URL_ENV] = "previous-template-url";
    mock.method(Pool.prototype, "query", (async (...args: unknown[]) => {
      const query = String(args[0]);
      queryCalls.push(query);
      return query.includes("server_version_num")
        ? ({ rows: [{ server_version_num: "180004" }] } as never)
        : ({ rows: [] } as never);
    }) as typeof Pool.prototype.query);
    mock.method(Pool.prototype, "end", async () => undefined);
    try {
      await assert.rejects(
        startMediumPostgresTemplate({
          initialize: async () => {
            throw new Error("migration setup failed");
          },
        }),
        /migration setup failed/,
      );
      assert.ok(
        queryCalls.some((query) => query.startsWith("CREATE DATABASE")),
      );
      assert.ok(queryCalls.some((query) => query.startsWith("DROP DATABASE")));
      assert.equal(
        process.env[MEDIUM_TEMPLATE_URL_ENV],
        "previous-template-url",
      );
    } finally {
      if (previousTemplateUrl === undefined) {
        delete process.env[MEDIUM_TEMPLATE_URL_ENV];
      } else {
        process.env[MEDIUM_TEMPLATE_URL_ENV] = previousTemplateUrl;
      }
      if (previousMaintenanceUrl === undefined) {
        delete process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL;
      } else {
        process.env.TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL =
          previousMaintenanceUrl;
      }
    }
  });
});

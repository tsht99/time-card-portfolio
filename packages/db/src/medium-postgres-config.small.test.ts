import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPostgres18Version,
  createMediumTemplateDatabaseName,
  parseExternalMaintenanceUrl,
} from "./test/medium-postgres-config.ts";

describe("external medium PostgreSQL configuration", () => {
  it("accepts PostgreSQL URLs to localhost maintenance databases", () => {
    assert.equal(
      parseExternalMaintenanceUrl(
        "postgresql://user:test-only@127.0.0.1:5432/postgres",
      ).hostname,
      "127.0.0.1",
    );
    assert.equal(
      parseExternalMaintenanceUrl(
        "postgres://user:test-only@[::1]:5432/postgres",
      ).hostname,
      "[::1]",
    );
    assert.equal(
      parseExternalMaintenanceUrl(
        "postgres://user:test-only@localhost/postgres",
      ).hostname,
      "localhost",
    );
  });

  it("rejects malformed, non-PostgreSQL, remote, and non-maintenance URLs", () => {
    for (const value of [
      "not a URL",
      "http://localhost/postgres",
      "postgres://user:test-only@example.com/postgres",
      "postgres://user:test-only@10.0.0.1/postgres",
      "postgres://user:test-only@localhost/timecard",
      "postgres://user:test-only@localhost/postgres?host=remote.example",
      "postgres://user:test-only@localhost/postgres#host=remote.example",
    ]) {
      assert.throws(() => parseExternalMaintenanceUrl(value));
    }
  });

  it("requires a reachable PostgreSQL 18 server", async () => {
    assert.doesNotThrow(() => assertPostgres18Version("180004"));
    assert.throws(() => assertPostgres18Version("170006"), /major version 18/);
  });

  it("creates a unique template database name per setup", () => {
    assert.notEqual(
      createMediumTemplateDatabaseName(),
      createMediumTemplateDatabaseName(),
    );
  });
});

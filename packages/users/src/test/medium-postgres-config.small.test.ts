import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMediumTemplateDatabaseName,
  parseExternalMaintenanceUrl,
} from "./medium-postgres-config.ts";

describe("external medium PostgreSQL configuration", () => {
  it("rejects remote hosts and connection override parameters", () => {
    for (const value of [
      "postgres://user:test-only@example.com/postgres",
      "postgres://user:test-only@localhost/postgres?host=remote.example",
      "postgres://user:test-only@localhost/postgres#host=remote.example",
    ]) {
      assert.throws(() => parseExternalMaintenanceUrl(value));
    }
  });

  it("creates a unique template database name per setup", () => {
    assert.notEqual(
      createMediumTemplateDatabaseName(),
      createMediumTemplateDatabaseName(),
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoolClient } from "pg";
import {
  assertConnectedMaintenanceDatabase,
  resolveMaintenanceConnection,
} from "./maintenance-connection.ts";

// cspell:ignore UNPOOLED pooler

const directUrl =
  "postgresql://maintenance:secret@ep-example.us-east-1.aws.neon.tech/timecard";

describe("maintenance connection guard", () => {
  it("resolves a local connection from DATABASE_URL", () => {
    const result = resolveMaintenanceConnection("local", {
      DATABASE_URL: directUrl,
    });

    assert.equal(result.connectionString, directUrl);
    assert.deepEqual(result.identity, {
      host: "ep-example.us-east-1.aws.neon.tech",
      database: "timecard",
    });
  });

  for (const environment of ["preview", "production"] as const) {
    it(`${environment} requires DATABASE_URL_UNPOOLED`, () => {
      assert.throws(
        () =>
          resolveMaintenanceConnection(environment, {
            DATABASE_URL: directUrl,
            DATABASE_MAINTENANCE_EXPECTED_HOST:
              "ep-example.us-east-1.aws.neon.tech",
            DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
          }),
        /DATABASE_URL_UNPOOLED is not set/,
      );
    });

    it(`${environment} requires expected host and database`, () => {
      assert.throws(
        () =>
          resolveMaintenanceConnection(environment, {
            DATABASE_URL_UNPOOLED: directUrl,
          }),
        /DATABASE_MAINTENANCE_EXPECTED_HOST is not set/,
      );
      assert.throws(
        () =>
          resolveMaintenanceConnection(environment, {
            DATABASE_URL_UNPOOLED: directUrl,
            DATABASE_MAINTENANCE_EXPECTED_HOST:
              "ep-example.us-east-1.aws.neon.tech",
          }),
        /DATABASE_MAINTENANCE_EXPECTED_DATABASE is not set/,
      );
    });
  }

  it("rejects a pooled Neon hostname, including as the expected host", () => {
    const pooledUrl =
      "postgresql://maintenance:secret@ep-example-pooler.us-east-1.aws.neon.tech/timecard";

    assert.throws(
      () =>
        resolveMaintenanceConnection("preview", {
          DATABASE_URL_UNPOOLED: pooledUrl,
          DATABASE_MAINTENANCE_EXPECTED_HOST:
            "ep-example-pooler.us-east-1.aws.neon.tech",
          DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
        }),
      /must be direct/,
    );
    assert.throws(
      () =>
        resolveMaintenanceConnection("preview", {
          DATABASE_URL_UNPOOLED: directUrl,
          DATABASE_MAINTENANCE_EXPECTED_HOST:
            "ep-example-pooler.us-east-1.aws.neon.tech",
          DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
        }),
      /must be direct/,
    );
  });

  it("rejects non-PostgreSQL and incomplete connection URLs", () => {
    for (const connectionString of [
      "https://example.test/timecard",
      "postgresql:///timecard",
      "postgresql://host.example.test/",
      "postgresql://host.example.test/%E0%A4%A",
    ]) {
      assert.throws(
        () =>
          resolveMaintenanceConnection("local", {
            DATABASE_URL: connectionString,
          }),
        /DATABASE_URL is invalid/,
      );
    }
  });

  it("rejects wrong host and wrong database before connecting", () => {
    assert.throws(
      () =>
        resolveMaintenanceConnection("production", {
          DATABASE_URL_UNPOOLED: directUrl,
          DATABASE_MAINTENANCE_EXPECTED_HOST: "another.example.test",
          DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
        }),
      /hostname does not match/,
    );
    assert.throws(
      () =>
        resolveMaintenanceConnection("production", {
          DATABASE_URL_UNPOOLED: directUrl,
          DATABASE_MAINTENANCE_EXPECTED_HOST:
            "ep-example.us-east-1.aws.neon.tech",
          DATABASE_MAINTENANCE_EXPECTED_DATABASE: "another_database",
        }),
      /database name does not match/,
    );
  });

  it("accepts a valid direct target and normalizes sslmode", () => {
    const result = resolveMaintenanceConnection("preview", {
      DATABASE_URL_UNPOOLED: `${directUrl}?sslmode=require`,
      DATABASE_MAINTENANCE_EXPECTED_HOST: "ep-example.us-east-1.aws.neon.tech",
      DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
    });

    assert.equal(result.connectionString, `${directUrl}?sslmode=verify-full`);
    assert.deepEqual(result.identity, {
      host: "ep-example.us-east-1.aws.neon.tech",
      database: "timecard",
    });
  });

  it("rejects a current_database mismatch without exposing credentials", async () => {
    const password = "super-secret-password";
    const connectionString = `postgresql://maintenance:${password}@host.example.test/timecard`;
    const identity = resolveMaintenanceConnection("local", {
      DATABASE_URL: connectionString,
    }).identity;
    const client = {
      query: async () => ({ rows: [{ database_name: "another_database" }] }),
    } as unknown as Pick<PoolClient, "query">;

    await assert.rejects(
      assertConnectedMaintenanceDatabase(client, identity),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, new RegExp(password));
        assert.doesNotMatch(error.message, new RegExp(connectionString));
        assert.match(error.message, /Connected database does not match/);
        return true;
      },
    );

    assert.throws(
      () =>
        resolveMaintenanceConnection("preview", {
          DATABASE_URL_UNPOOLED: connectionString,
          DATABASE_MAINTENANCE_EXPECTED_HOST: "other.example.test",
          DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, new RegExp(password));
        assert.doesNotMatch(error.message, new RegExp(connectionString));
        return true;
      },
    );
  });
});

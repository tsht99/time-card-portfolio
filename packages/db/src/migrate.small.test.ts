import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMigrations } from "./migration-runner.ts";

// cspell:ignore UNPOOLED

describe("migration runner validation", () => {
  it("rejects missing DATABASE_URL before connecting", async () => {
    await assert.rejects(
      runMigrations("local", { DATABASE_ENVIRONMENT: "local" }),
      /DATABASE_URL is not set/,
    );
  });

  it("rejects a non-PostgreSQL URL", async () => {
    await assert.rejects(
      runMigrations("local", {
        DATABASE_ENVIRONMENT: "local",
        DATABASE_URL: "https://example.test",
      }),
      /DATABASE_URL is invalid/,
    );
  });

  it("rejects a preview target mismatch before connecting", async () => {
    await assert.rejects(
      runMigrations("deploy", {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "develop",
        DATABASE_ENVIRONMENT: "preview",
        DATABASE_URL: "postgresql://user:secret@wrong.example.test/wrong",
        DATABASE_URL_UNPOOLED:
          "postgresql://user:secret@direct.example.test/timecard",
        DATABASE_MAINTENANCE_EXPECTED_HOST: "expected.example.test",
        DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
      }),
      /hostname does not match/,
    );
  });

  it("rejects a production database mismatch before connecting", async () => {
    await assert.rejects(
      runMigrations("deploy", {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        DATABASE_ENVIRONMENT: "production",
        DATABASE_URL_UNPOOLED:
          "postgresql://user:secret@direct.example.test/other",
        DATABASE_MAINTENANCE_EXPECTED_HOST: "direct.example.test",
        DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
      }),
      /database name does not match/,
    );
  });
});

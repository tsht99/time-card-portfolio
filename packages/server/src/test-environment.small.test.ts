import assert from "node:assert/strict";
import test from "node:test";
import { getSentryRuntimeConfiguration } from "./env.ts";

test("server tests use the repository-managed test environment", () => {
  assert.equal(
    process.env.DATABASE_URL,
    "postgresql://test:test@localhost:5432/timecard_test",
  );
  assert.equal(process.env.LINE_CHANNEL_ID, "test-line-channel-id");
  assert.equal(process.env.SENTRY_DSN, "");
  assert.equal(process.env.VERCEL_GIT_COMMIT_SHA, "");

  assert.equal(getSentryRuntimeConfiguration(), undefined);
});

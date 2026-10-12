import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateMigrationContext } from "./migration-context.ts";

const local = { DATABASE_ENVIRONMENT: "local" };
const fail = (mode: "local" | "deploy", env: NodeJS.ProcessEnv) =>
  assert.throws(() => validateMigrationContext(mode, env));

describe("migration context", () => {
  it("allows local", () =>
    assert.equal(
      validateMigrationContext("local", local).environment,
      "local",
    ));
  it("rejects missing environment and deploy outside Vercel", () => {
    fail("local", {});
    fail("local", { DATABASE_ENVIRONMENT: "preview" });
    fail("local", { DATABASE_ENVIRONMENT: "production" });
    fail("deploy", local);
  });
  it("allows matching preview and production deploys", () => {
    assert.equal(
      validateMigrationContext("deploy", {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "develop",
        DATABASE_ENVIRONMENT: "preview",
      }).environment,
      "preview",
    );
    assert.equal(
      validateMigrationContext("deploy", {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        DATABASE_ENVIRONMENT: "production",
      }).environment,
      "production",
    );
  });
  it("rejects unsupported or incomplete Vercel contexts", () => {
    for (const env of [
      {
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "develop",
        DATABASE_ENVIRONMENT: "preview",
      },
      {
        VERCEL: "1",
        VERCEL_GIT_COMMIT_REF: "develop",
        DATABASE_ENVIRONMENT: "preview",
      },
      { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_ENVIRONMENT: "preview" },
      {
        VERCEL: "1",
        VERCEL_ENV: "staging",
        VERCEL_GIT_COMMIT_REF: "develop",
        DATABASE_ENVIRONMENT: "preview",
      },
      {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/x",
        DATABASE_ENVIRONMENT: "preview",
      },
      {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "master",
        DATABASE_ENVIRONMENT: "production",
      },
      {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "develop",
        DATABASE_ENVIRONMENT: "production",
      },
      {
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "develop",
        DATABASE_ENVIRONMENT: "production",
      },
    ])
      fail("deploy", env);
  });
  it("rejects local runner on Vercel", () =>
    fail("local", {
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "develop",
      DATABASE_ENVIRONMENT: "preview",
    }));
});

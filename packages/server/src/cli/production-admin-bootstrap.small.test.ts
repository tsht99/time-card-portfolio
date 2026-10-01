import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProductionAdminBootstrapArguments,
  validateProductionAdminBootstrapEnvironment,
} from "./production-admin-bootstrap-options.ts";

const validArguments = [
  "--expected-host",
  "db.example.test",
  "--expected-database",
  "timecard",
  "--line-user-id",
  "U123",
];

test("production bootstrap requires all expected identity arguments", () => {
  assert.throws(
    () => parseProductionAdminBootstrapArguments(["--apply"]),
    /--expected-host is required/,
  );
  assert.throws(
    () =>
      parseProductionAdminBootstrapArguments([
        "--expected-host",
        "db.example.test",
        "--expected-database",
        "timecard",
        "--line-user-id",
        "--apply",
      ]),
    /--line-user-id is required/,
  );
});

test("production bootstrap accepts apply and inline option values", () => {
  assert.deepEqual(
    parseProductionAdminBootstrapArguments([
      "--expected-host=db.example.test",
      "--expected-database=timecard",
      "--line-user-id=U123",
      "--apply",
    ]),
    {
      expectedHost: "db.example.test",
      expectedDatabase: "timecard",
      lineUserId: "U123",
      apply: true,
    },
  );
});

test("production bootstrap rejects non-production environment before URL use", () => {
  const options = parseProductionAdminBootstrapArguments(validArguments);
  assert.throws(
    () =>
      validateProductionAdminBootstrapEnvironment(options, {
        DATABASE_ENVIRONMENT: "preview",
        DATABASE_URL: "not-a-url",
      }),
    /DATABASE_ENVIRONMENT must be production/,
  );
});

test("production bootstrap validates DATABASE_URL and expected identity", () => {
  const options = parseProductionAdminBootstrapArguments(validArguments);

  assert.throws(
    () =>
      validateProductionAdminBootstrapEnvironment(options, {
        DATABASE_ENVIRONMENT: "production",
      }),
    /DATABASE_URL is not set/,
  );
  assert.throws(
    () =>
      validateProductionAdminBootstrapEnvironment(options, {
        DATABASE_ENVIRONMENT: "production",
        DATABASE_URL: "https://db.example.test/timecard",
      }),
    /DATABASE_URL is invalid/,
  );
  assert.throws(
    () =>
      validateProductionAdminBootstrapEnvironment(options, {
        DATABASE_ENVIRONMENT: "production",
        DATABASE_URL: "postgresql://user:secret@other.example.test/timecard",
      }),
    /hostname does not match/,
  );
  assert.throws(
    () =>
      validateProductionAdminBootstrapEnvironment(options, {
        DATABASE_ENVIRONMENT: "production",
        DATABASE_URL: "postgresql://user:secret@db.example.test/other",
      }),
    /database name does not match/,
  );

  const parsed = validateProductionAdminBootstrapEnvironment(options, {
    DATABASE_ENVIRONMENT: "production",
    DATABASE_URL: "postgresql://user:secret@db.example.test/timecard",
  });
  assert.deepEqual(parsed.identity, {
    host: "db.example.test",
    database: "timecard",
  });
});

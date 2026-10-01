import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommands,
  ensureLocalPortsAvailable,
  parseEnvFile,
  validateConfig,
} from "./dev-web-local.mjs";

const validEnvironment = {
  DATABASE_URL: "postgresql://localhost/timecard",
  DATABASE_ENVIRONMENT: "local",
  LINE_CHANNEL_ID: "1234567890",
  NEXT_PUBLIC_LIFF_ID: "1234567890-AbCdEf",
};

test("parseEnvFile reads comments and quoted values", () => {
  assert.deepEqual(
    parseEnvFile('# comment\nDATABASE_URL="postgres://db"\nKEY=value'),
    { DATABASE_URL: "postgres://db", KEY: "value" },
  );
});

test("validateConfig requires local credentials, local DB environment, and certificates", () => {
  assert.equal(
    validateConfig(validEnvironment, ["localhost.pem", "localhost-key.pem"])
      .DATABASE_ENVIRONMENT,
    "local",
  );
  assert.throws(() =>
    validateConfig({ ...validEnvironment, LINE_CHANNEL_ID: "" }, [
      "localhost.pem",
      "localhost-key.pem",
    ]),
  );
  assert.throws(() =>
    validateConfig(
      { ...validEnvironment, DATABASE_ENVIRONMENT: "production" },
      ["localhost.pem", "localhost-key.pem"],
    ),
  );
  assert.throws(() => {
    const { DATABASE_ENVIRONMENT: _omitted, ...withoutDatabaseEnvironment } =
      validEnvironment;
    validateConfig(withoutDatabaseEnvironment, [
      "localhost.pem",
      "localhost-key.pem",
    ]);
  });
  assert.throws(() => validateConfig(validEnvironment, ["localhost.pem"]));
});

test("buildCommands configures the local DB migration and HTTPS web app", () => {
  const commands = buildCommands("/workspace");
  assert.deepEqual(
    commands.map(({ args }) => args),
    [
      ["--filter", "@repo/db", "migrate"],
      [
        "--filter",
        "web",
        "exec",
        "next",
        "dev",
        "--webpack",
        "--port",
        "3000",
        "--experimental-https",
        "--experimental-https-key",
        "/workspace/localhost-key.pem",
        "--experimental-https-cert",
        "/workspace/localhost.pem",
      ],
    ],
  );
});

test("ensureLocalPortsAvailable reports when the web port is in use", async () => {
  await assert.rejects(
    ensureLocalPortsAvailable(async (port) => {
      if (port === 3000) {
        const error = new Error("address in use");
        error.code = "EADDRINUSE";
        throw error;
      }
    }),
    /localhost:3000 は既に使用されています。/u,
  );
});

test("ensureLocalPortsAvailable succeeds when the web port is available", async () => {
  const checkedPorts = [];
  await ensureLocalPortsAvailable(async (port) => {
    checkedPorts.push(port);
  });
  assert.deepEqual(checkedPorts, [3000]);
});

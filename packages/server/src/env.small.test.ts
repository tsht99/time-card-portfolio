import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const baseEnv = {
  PATH: process.env.PATH,
};

function runModuleExpression(
  expression: string,
  overrides: Record<string, string | undefined> = {},
) {
  const childEnv: Record<string, string | undefined> = {
    ...baseEnv,
    ...overrides,
  };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }

  return spawnSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import("./src/env.ts").then((module) => console.log(JSON.stringify(${expression})))`,
    ],
    { cwd: process.cwd(), env: childEnv, encoding: "utf8" },
  );
}

function runImport(
  modulePath: string,
  overrides: Record<string, string | undefined> = {},
) {
  const childEnv: Record<string, string | undefined> = {
    ...baseEnv,
    ...overrides,
  };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }

  return spawnSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(modulePath)}).then(() => console.log("ok"))`,
    ],
    { cwd: process.cwd(), env: childEnv, encoding: "utf8" },
  );
}

test("public server env export does not require DATABASE_URL or LINE_CHANNEL_ID", () => {
  const result = runImport("@repo/server/env", {
    DATABASE_URL: undefined,
    LINE_CHANNEL_ID: undefined,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ok");
});

test("LINE_CHANNEL_ID is read and validated when LINE authentication uses it", () => {
  assert.notEqual(
    runModuleExpression("module.getLineChannelId()", {
      LINE_CHANNEL_ID: undefined,
    }).status,
    0,
  );
  assert.notEqual(
    runModuleExpression("module.getLineChannelId()", {
      LINE_CHANNEL_ID: "",
    }).status,
    0,
  );

  const result = runModuleExpression("module.getLineChannelId()", {
    LINE_CHANNEL_ID: "test-line-channel-id",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), "test-line-channel-id");
});

test("SESSION_TTL_HOURS defaults to 24 and rejects invalid values when used", () => {
  const defaultResult = runModuleExpression("module.getSessionTtlHours()", {
    SESSION_TTL_HOURS: undefined,
  });
  assert.equal(defaultResult.status, 0, defaultResult.stderr);
  assert.equal(JSON.parse(defaultResult.stdout), 24);

  assert.notEqual(
    runModuleExpression("module.getSessionTtlHours()", {
      SESSION_TTL_HOURS: "0",
    }).status,
    0,
  );
});

test("server-side Sentry configuration keeps optional and release fallback semantics", () => {
  const absent = runModuleExpression("module.getSentryRuntimeConfiguration()", {
    SENTRY_DSN: "",
    SENTRY_ENVIRONMENT: "",
    SENTRY_RELEASE: "",
    VERCEL_GIT_COMMIT_SHA: "",
  });
  assert.equal(absent.status, 0, absent.stderr);
  assert.equal(absent.stdout.trim(), "undefined");

  const fallback = runModuleExpression(
    "module.getSentryRuntimeConfiguration()",
    {
      SENTRY_DSN: "https://public@example.com/1",
      SENTRY_ENVIRONMENT: "preview",
      SENTRY_RELEASE: "",
      VERCEL_GIT_COMMIT_SHA: "commit-sha",
    },
  );
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.deepEqual(JSON.parse(fallback.stdout), {
    dsn: "https://public@example.com/1",
    environment: "preview",
    release: "commit-sha",
  });
});

test("validateServerRuntimeEnvironment detects missing server-owned required configuration", () => {
  const missingLine = runModuleExpression(
    "module.validateServerRuntimeEnvironment()",
    { LINE_CHANNEL_ID: undefined },
  );
  assert.notEqual(missingLine.status, 0);

  const valid = runModuleExpression(
    "module.validateServerRuntimeEnvironment()",
    { LINE_CHANNEL_ID: "test-line-channel-id", DATABASE_URL: undefined },
  );
  assert.equal(valid.status, 0, valid.stderr);
});

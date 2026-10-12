import assert from "node:assert/strict";
import test from "node:test";
import { getMediumTestEnv, runMediumTests } from "./run-medium-tests.mjs";
import { QUALITY_TEST_ENV } from "./test-environment.mjs";

test("standalone Medium tasks receive the shared test-only build environment", () => {
  assert.deepEqual(getMediumTestEnv({ CI: "1" }), {
    ...QUALITY_TEST_ENV,
    CI: "1",
  });
});

test("caller environment values take precedence over test defaults", () => {
  assert.equal(
    getMediumTestEnv({ NEXT_PUBLIC_HELP_URL: "https://custom.example.test" })
      .NEXT_PUBLIC_HELP_URL,
    "https://custom.example.test",
  );
});

test("Medium runner passes task arguments and the shared environment", () => {
  const calls = [];
  const exitCode = runMediumTests({
    turboArguments: ["--affected"],
    env: {},
    runCommand: (...args) => {
      calls.push(args);
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    [
      ["--affected"],
      {
        cwd: process.cwd(),
        env: QUALITY_TEST_ENV,
        stdio: "inherit",
      },
    ],
  ]);
});

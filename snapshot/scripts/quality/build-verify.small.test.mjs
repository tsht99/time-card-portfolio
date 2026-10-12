import assert from "node:assert/strict";
import { test } from "node:test";
import { runBuildVerify } from "./build-verify.mjs";
import { QUALITY_TEST_ENV } from "./test-environment.mjs";

test("build:verify injects the shared test environment into root build", () => {
  const calls = [];
  const exitCode = runBuildVerify({
    runCommand(...args) {
      calls.push(args);
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [["build", { env: QUALITY_TEST_ENV }]]);
});

test("build:verify reports a failing build with a non-zero exit code", () => {
  assert.equal(runBuildVerify({ runCommand: () => 1 }), 1);
});

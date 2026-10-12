import assert from "node:assert/strict";
import test from "node:test";
import { runAffectedTests } from "./run-affected-tests.mjs";

test("affected Small runs root suite before Turbo workspace selection", () => {
  const calls = [];
  const exitCode = runAffectedTests({
    size: "small",
    env: { TURBO_SCM_BASE: "base", TURBO_SCM_HEAD: "head" },
    runCommand(...args) {
      calls.push(args);
      return true;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    calls.map(([, args]) => args),
    [
      ["test:small:scripts"],
      ["exec", "turbo", "run", "test:small", "--affected"],
    ],
  );
  assert.equal(calls[1][2].TURBO_SCM_BASE, "base");
  assert.equal(calls[1][2].TURBO_SCM_HEAD, "head");
});

test("affected Medium keeps root suite and serial Turbo execution", () => {
  const calls = [];
  const exitCode = runAffectedTests({
    size: "medium",
    runCommand(...args) {
      calls.push(args);
      return true;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    calls.map(([, args]) => args),
    [
      ["test:medium:scripts"],
      ["exec", "turbo", "run", "test:medium", "--affected", "--concurrency=1"],
    ],
  );
});

test("workspace selection is skipped when root tests fail", () => {
  const calls = [];
  const exitCode = runAffectedTests({
    size: "small",
    runCommand(...args) {
      calls.push(args);
      return false;
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(calls.length, 1);
});

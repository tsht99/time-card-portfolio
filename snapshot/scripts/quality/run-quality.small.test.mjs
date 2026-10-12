import assert from "node:assert/strict";
import test from "node:test";
import { QUALITY_STAGES, runQuality } from "./run-quality.mjs";
import { QUALITY_TEST_ENV } from "./test-environment.mjs";

function runWithFailures(failures = [], options = {}) {
  const executed = [];
  const output = [];
  const result = runQuality({
    ...options,
    runCommand(command) {
      executed.push(command);
      return failures.includes(command) ? 1 : 0;
    },
    write(line) {
      output.push(line);
    },
  });
  return { executed, output, result };
}

test("runs all early diagnostics in order even when multiple checks fail", () => {
  const { executed, result } = runWithFailures([
    "lint",
    "spellcheck",
    "test:small",
  ]);

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
  ]);
  assert.deepEqual(
    result.results.map(({ name, status }) => [name, status]),
    [
      ["format:check", "PASS"],
      ["lint", "FAIL"],
      ["spellcheck", "FAIL"],
      ["knip", "PASS"],
      ["knip:production-exports", "PASS"],
      ["typecheck", "PASS"],
      ["test:small", "FAIL"],
      ["build", "SKIP"],
      ["build:storybook", "SKIP"],
      ["test:medium", "SKIP"],
    ],
  );
  assert.equal(result.exitCode, 1);
});

test("continues later early diagnostics after spellcheck fails", () => {
  const { executed, result } = runWithFailures(["spellcheck"]);

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
  ]);
  assert.equal(result.results[2].status, "FAIL");
  assert.equal(result.results[3].status, "PASS");
  assert.equal(result.results[4].status, "PASS");
  assert.equal(result.results[5].status, "PASS");
  assert.equal(result.results[6].status, "PASS");
  assert.equal(result.exitCode, 1);
});

test("skips build and Medium Test after an early diagnostic failure", () => {
  const { executed, result } = runWithFailures(["knip"]);

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
  ]);
  assert.match(result.results[7].reason, /早期診断チェックの失敗/u);
  assert.match(result.results[9].reason, /早期診断チェックの失敗/u);
});

test("treats production export Knip as a hard gate after early diagnostics", () => {
  const { executed, result } = runWithFailures(["knip:production-exports"]);

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
  ]);
  assert.equal(result.results[4].status, "FAIL");
  assert.equal(result.results[5].status, "PASS");
  assert.equal(result.results[6].status, "PASS");
  assert.equal(result.results[7].status, "SKIP");
  assert.equal(result.results[9].status, "SKIP");
  assert.match(result.results[7].reason, /早期診断チェックの失敗/u);
  assert.match(result.results[9].reason, /早期診断チェックの失敗/u);
  assert.equal(result.exitCode, 1);
});

test("runs build but skips Medium Test when build fails", () => {
  const { executed, result } = runWithFailures(["build"]);

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
    "build",
    "build:storybook",
  ]);
  assert.equal(result.results[7].status, "FAIL");
  assert.equal(result.results[9].status, "SKIP");
  assert.match(
    result.results[9].reason,
    /build または build:storybook の失敗/u,
  );
  assert.equal(result.exitCode, 1);
});

test("runs all Medium Test after a successful build and fails when it fails", () => {
  const { executed, result } = runWithFailures(["test:medium"]);

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
    "build",
    "build:storybook",
    "test:medium",
  ]);
  assert.equal(result.results[7].status, "PASS");
  assert.equal(result.results[9].status, "FAIL");
  assert.equal(result.exitCode, 1);
});

test("fails Quality and skips Medium Test when Storybook static build fails", () => {
  const { executed, result } = runWithFailures(["build:storybook"]);

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
    "build",
    "build:storybook",
  ]);
  assert.equal(result.results[7].status, "PASS");
  assert.equal(result.results[8].status, "FAIL");
  assert.equal(result.results[9].status, "SKIP");
  assert.match(
    result.results[9].reason,
    /build または build:storybook の失敗/u,
  );
  assert.equal(result.exitCode, 1);
});

test("uses the full Medium Test command by default", () => {
  const { executed, result } = runWithFailures();

  assert.equal(executed.at(-1), "test:medium");
  assert.equal(result.results[9].status, "PASS");
});

test("fails Quality when Medium Test fails", () => {
  const { executed, result } = runWithFailures(["test:medium"]);

  assert.equal(executed.at(-1), "test:medium");
  assert.equal(result.results[9].status, "FAIL");
  assert.equal(result.exitCode, 1);
});

test("keeps the default full test commands when no affected options are given", () => {
  const { executed, result } = runWithFailures();

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
    "build",
    "build:storybook",
    "test:medium",
  ]);
  assert.deepEqual(
    result.results.map(({ name }) => name),
    [
      "format:check",
      "lint",
      "spellcheck",
      "knip",
      "knip:production-exports",
      "typecheck",
      "test:small",
      "build",
      "build:storybook",
      "test:medium",
    ],
  );
});

test("supports static-only stage skips while preserving common gate order and failures", () => {
  const { executed, result, output } = runWithFailures(["spellcheck"], {
    smallCommand: "test:small:scripts",
    skippedStages: {
      typecheck: "runtime 非影響変更のみのため省略",
      build: "runtime 非影響変更のみのため省略",
      "test:medium": "runtime 非影響変更のみのため省略",
    },
  });
  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "test:small:scripts",
  ]);
  assert.equal(result.exitCode, 1);
  for (const stage of ["typecheck", "build", "test:medium"]) {
    const summary = result.results.find(({ name }) => name === stage);
    assert.equal(summary.status, "SKIP");
    assert.match(summary.reason, /runtime 非影響変更のみ/u);
  }
  assert.ok(output.some((line) => line.includes("- test:small: PASS")));
});

test("uses affected test commands without changing stage names or gate order", () => {
  const executed = [];
  const options = [];
  const output = [];
  const result = runQuality({
    smallCommand: "node scripts/quality/run-affected-tests.mjs small",
    mediumCommand: "node scripts/quality/run-affected-tests.mjs medium",
    smallEnv: { TURBO_SCM_BASE: "base", TURBO_SCM_HEAD: "head" },
    mediumEnv: { TURBO_SCM_BASE: "base", TURBO_SCM_HEAD: "head" },
    runCommand(command, commandOptions) {
      executed.push(command);
      options.push(commandOptions);
      return 0;
    },
    write(line) {
      output.push(line);
    },
  });

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "node scripts/quality/run-affected-tests.mjs small",
    "build",
    "build:storybook",
    "node scripts/quality/run-affected-tests.mjs medium",
  ]);
  assert.deepEqual(
    result.results.map(({ name, status }) => [name, status]),
    [
      ["format:check", "PASS"],
      ["lint", "PASS"],
      ["spellcheck", "PASS"],
      ["knip", "PASS"],
      ["knip:production-exports", "PASS"],
      ["typecheck", "PASS"],
      ["test:small", "PASS"],
      ["build", "PASS"],
      ["build:storybook", "PASS"],
      ["test:medium", "PASS"],
    ],
  );
  const expectedTestEnv = {
    ...QUALITY_TEST_ENV,
    TURBO_SCM_BASE: "base",
    TURBO_SCM_HEAD: "head",
  };
  assert.deepEqual(options[6], {
    env: expectedTestEnv,
  });
  assert.deepEqual(options[9], options[6]);
  assert.deepEqual(output, [
    "\nQuality summary:",
    "- format:check: PASS",
    "- lint: PASS",
    "- spellcheck: PASS",
    "- knip: PASS",
    "- knip:production-exports: PASS",
    "- typecheck: PASS",
    "- test:small: PASS",
    "- build: PASS",
    "- build:storybook: PASS",
    "- test:medium: PASS",
  ]);
});

test("uses managed Help URLs and media bases for build-capable stages", () => {
  const commandOptions = [];
  const result = runQuality({
    runCommand(_command, options) {
      commandOptions.push(options);
      return 0;
    },
    write() {},
  });

  assert.equal(result.exitCode, 0);
  const expected = {
    env: QUALITY_TEST_ENV,
  };
  for (const index of [5, 6, 7, 9]) {
    assert.deepEqual(commandOptions[index], expected);
  }
});

test("preserves non-zero results and later-stage SKIP behavior for affected commands", () => {
  const executed = [];
  const result = runQuality({
    smallCommand: "node scripts/quality/run-affected-tests.mjs small",
    mediumCommand: "node scripts/quality/run-affected-tests.mjs medium",
    runCommand(command) {
      executed.push(command);
      return command === "node scripts/quality/run-affected-tests.mjs small"
        ? 1
        : 0;
    },
    write() {},
  });

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "node scripts/quality/run-affected-tests.mjs small",
  ]);
  assert.equal(result.results[6].status, "FAIL");
  assert.equal(result.results[7].status, "SKIP");
  assert.equal(result.results[9].status, "SKIP");
  assert.equal(result.exitCode, 1);
});

test("fails Quality when the affected Medium Test command fails", () => {
  const executed = [];
  const result = runQuality({
    smallCommand: "node scripts/quality/run-affected-tests.mjs small",
    mediumCommand: "node scripts/quality/run-affected-tests.mjs medium",
    runCommand(command) {
      executed.push(command);
      return command === "node scripts/quality/run-affected-tests.mjs medium"
        ? 1
        : 0;
    },
    write() {},
  });

  assert.equal(
    executed.at(-1),
    "node scripts/quality/run-affected-tests.mjs medium",
  );
  assert.equal(result.results[9].name, "test:medium");
  assert.equal(result.results[9].status, "FAIL");
  assert.equal(result.exitCode, 1);
});

test("reports PASS for every required check only when every command succeeds", () => {
  const { executed, output, result } = runWithFailures();

  assert.deepEqual(executed, [
    "format:check",
    "lint",
    "spellcheck",
    "knip",
    "knip:production-exports",
    "typecheck",
    "test:small",
    "build",
    "build:storybook",
    "test:medium",
  ]);
  assert.deepEqual(
    result.results.map(({ status }) => status),
    [
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ],
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(output, [
    "\nQuality summary:",
    "- format:check: PASS",
    "- lint: PASS",
    "- spellcheck: PASS",
    "- knip: PASS",
    "- knip:production-exports: PASS",
    "- typecheck: PASS",
    "- test:small: PASS",
    "- build: PASS",
    "- build:storybook: PASS",
    "- test:medium: PASS",
  ]);
});

test("uses stage metadata for command substitution and phase options", () => {
  const small = QUALITY_STAGES.find(({ name }) => name === "test:small");
  const medium = QUALITY_STAGES.find(({ name }) => name === "test:medium");
  const build = QUALITY_STAGES.find(({ name }) => name === "build");

  assert.deepEqual(
    [small.phase, small.command, small.commandOption, small.env],
    ["early", "test:small", "smallCommand", "smallTest"],
  );
  assert.deepEqual(
    [medium.phase, medium.command, medium.commandOption, medium.env],
    ["medium", "test:medium", "mediumCommand", "mediumTest"],
  );
  assert.deepEqual(
    [build.phase, build.command, build.env],
    ["build", "build", "help"],
  );
});

test("does not depend on stage positions when an early diagnostic is added", () => {
  const addedStage = {
    name: "diagnostic:extra",
    command: "diagnostic:extra",
    phase: "early",
  };
  QUALITY_STAGES.splice(0, 0, addedStage);
  try {
    const { executed, result } = runWithFailures(["diagnostic:extra"]);

    assert.deepEqual(executed, [
      "diagnostic:extra",
      "format:check",
      "lint",
      "spellcheck",
      "knip",
      "knip:production-exports",
      "typecheck",
      "test:small",
    ]);
    assert.equal(result.results[0].status, "FAIL");
    assert.equal(
      result.results.find(({ name }) => name === "build").status,
      "SKIP",
    );
    assert.equal(
      result.results.find(({ name }) => name === "test:medium").status,
      "SKIP",
    );
  } finally {
    QUALITY_STAGES.shift();
  }
});

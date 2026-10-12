import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveQualityExecution,
  resolveQualityRange,
  runQualityAffected,
} from "./quality-affected.mjs";

const rangeEnv = { TURBO_SCM_BASE: "base", TURBO_SCM_HEAD: "head" };

function fakeGit({
  status = "",
  commits = {
    HEAD: "head",
    base: "base",
    head: "head",
    "refs/remotes/origin/develop": "base",
  },
  ancestor = true,
  files = ["apps/web/src/page.tsx"],
  fail = [],
} = {}) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    if (fail.includes(args[0]))
      return { status: 128, stdout: "", stderr: `${args[0]} failed` };
    if (args[0] === "status") return { status: 0, stdout: status, stderr: "" };
    if (args[0] === "rev-parse") {
      const ref = args.at(-1).replace(/\^\{commit\}$/u, "");
      return commits[ref]
        ? { status: 0, stdout: `${commits[ref]}\n`, stderr: "" }
        : { status: 128, stdout: "", stderr: "unknown revision" };
    }
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      return { status: ancestor ? 0 : 1, stdout: "", stderr: "" };
    }
    if (args[0] === "diff")
      return { status: 0, stdout: `${files.join("\0")}\0`, stderr: "" };
    throw new Error(`Unexpected Git command: ${args.join(" ")}`);
  };
  return { calls, runGit };
}

function range(options = {}) {
  return resolveQualityRange({
    env: rangeEnv,
    runGit: fakeGit(options).runGit,
  });
}

test("runtime non-impact changes use static-only quality", () => {
  for (const file of [
    "docs/要件定義書.md",
    "README.md",
    ".vscode/settings.json",
  ]) {
    assert.equal(range({ files: [file] }).mode, "static-only");
  }
});

test("workspace runtime changes select Turbo affected Small and Medium commands", () => {
  const execution = resolveQualityExecution({
    range: {
      mode: "affected",
      base: "base",
      head: "head",
      files: ["apps/web/src/page.tsx"],
    },
  });
  assert.equal(execution.mode, "affected");
  assert.equal(
    execution.smallCommand,
    "node scripts/quality/run-affected-tests.mjs small",
  );
  assert.equal(
    execution.mediumCommand,
    "node scripts/quality/run-affected-tests.mjs medium",
  );
  assert.deepEqual(execution.smallEnv, rangeEnv);
  assert.deepEqual(execution.mediumEnv, rangeEnv);
});

test("unresolvable Git ranges use full Quality while other runtime paths reach Turbo", () => {
  assert.equal(range({ fail: ["rev-parse"] }).mode, "full");
  assert.equal(range({ ancestor: false }).mode, "full");
  assert.equal(range({ files: [] }).mode, "full");
  assert.equal(range({ status: " M apps/web/src/page.tsx\0" }).mode, "full");
  for (const file of [
    "package.json",
    "scripts/quality/run-quality.mjs",
    ".github/workflows/quality.yml",
  ]) {
    assert.equal(range({ files: [file] }).mode, "affected", file);
  }
});

test("affected runs retain root tests while static-only omits runtime tests", () => {
  for (const mode of ["affected", "static-only"]) {
    const executed = [];
    const result = runQualityAffected({
      resolveRange: () =>
        mode === "static-only"
          ? { mode, reason: "runtime 非影響変更のみです" }
          : {
              mode,
              base: "base",
              head: "head",
              files: ["apps/web/src/page.tsx"],
            },
      runCommand(command) {
        executed.push(command);
        return 0;
      },
      write() {},
    });
    assert.equal(result.exitCode, 0);
    if (mode === "static-only") {
      assert.ok(!executed.includes("test:small"));
      assert.ok(!executed.includes("test:medium"));
    } else {
      assert.ok(
        executed.includes("node scripts/quality/run-affected-tests.mjs small"),
      );
      assert.ok(
        executed.includes("node scripts/quality/run-affected-tests.mjs medium"),
      );
    }
  }
});

test("Turbo affected task failures remain Quality failures", () => {
  const result = runQualityAffected({
    resolveRange: () => ({
      mode: "affected",
      base: "base",
      head: "head",
      files: ["apps/web/src/page.tsx"],
    }),
    runCommand(command) {
      return command === "node scripts/quality/run-affected-tests.mjs medium"
        ? 1
        : 0;
    },
    write() {},
  });
  assert.equal(result.exitCode, 1);
  assert.equal(
    result.results.find(({ name }) => name === "test:medium").status,
    "FAIL",
  );
});

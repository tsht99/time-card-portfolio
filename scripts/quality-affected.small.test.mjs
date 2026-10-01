import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  resolveQualityExecution,
  resolveQualityMode,
  resolveQualityRange,
  runQualityAffected,
} from "./quality-affected.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUALITY_RANGE_ENV = {
  TURBO_SCM_BASE: "base",
  TURBO_SCM_HEAD: "head",
};
const WORKSPACE_ROOTS = [
  "apps/e2e",
  "apps/web",
  "packages/attendance",
  "packages/db",
  "packages/payroll",
  "packages/users",
  "packages/server",
];
const WORKSPACES = [
  {
    root: "apps/e2e",
    name: "e2e",
    manifest: {
      devDependencies: { web: "workspace:*", "@repo/db": "workspace:*" },
    },
  },
  {
    root: "apps/web",
    name: "web",
    manifest: {
      dependencies: {
        "@repo/payroll": "workspace:*",
        "@repo/server": "workspace:*",
        "@repo/users": "workspace:*",
      },
    },
  },
  {
    root: "packages/attendance",
    name: "@repo/attendance",
    manifest: { dependencies: { "@repo/users": "workspace:*" } },
  },
  {
    root: "packages/db",
    name: "@repo/db",
    manifest: { dependencies: { "@repo/attendance": "workspace:*" } },
  },
  {
    root: "packages/payroll",
    name: "@repo/payroll",
    manifest: {
      dependencies: {
        "@repo/attendance": "workspace:*",
        "@repo/platform": "workspace:*",
        "@repo/users": "workspace:*",
      },
    },
  },
  {
    root: "packages/users",
    name: "@repo/users",
    manifest: {},
  },
  {
    root: "packages/server",
    name: "@repo/server",
    manifest: {
      dependencies: {
        "@repo/db": "workspace:*",
        "@repo/users": "workspace:*",
      },
      devDependencies: { "@repo/payroll": "workspace:*" },
    },
  },
];

function fakeGit({
  status = "",
  commits = {
    HEAD: "head",
    "refs/remotes/origin/develop": "origin",
    base: "base",
    head: "head",
    origin: "origin",
  },
  mergeBase = "base",
  ancestor = true,
  files = ["apps/web/src/page.tsx"],
  fail = [],
} = {}) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    const command = args[0];
    if (fail.includes(command)) {
      return { status: 128, stdout: "", stderr: `${command} failed` };
    }
    if (command === "status") {
      return { status: 0, stdout: status, stderr: "" };
    }
    if (command === "rev-parse") {
      const ref = args.at(-1).replace(/\^\{commit\}$/u, "");
      return commits[ref]
        ? { status: 0, stdout: `${commits[ref]}\n`, stderr: "" }
        : { status: 128, stdout: "", stderr: "unknown revision" };
    }
    if (command === "merge-base" && args[1] === "--is-ancestor") {
      return { status: ancestor ? 0 : 1, stdout: "", stderr: "" };
    }
    if (command === "merge-base") {
      return { status: 0, stdout: `${mergeBase}\n`, stderr: "" };
    }
    if (command === "diff") {
      return { status: 0, stdout: `${files.join("\0")}\0`, stderr: "" };
    }
    throw new Error(`Unexpected Git command: ${args.join(" ")}`);
  };
  return { calls, runGit };
}

function fakeTurbo({ small = ["web"], medium = ["web", "e2e"], fail } = {}) {
  const calls = [];
  const runTurbo = (task, options) => {
    calls.push({ task, options });
    if (fail === task) return { status: 1, stdout: "", stderr: "turbo failed" };
    const packages = task === "test:small" ? small : medium;
    return {
      status: 0,
      stdout: JSON.stringify({
        tasks: packages.map((packageName) => ({ task, package: packageName })),
      }),
      stderr: "",
    };
  };
  return { calls, runTurbo };
}

function resolve(options = {}) {
  return resolveQualityRange({
    env: { TURBO_SCM_BASE: "base", TURBO_SCM_HEAD: "head" },
    workspaceRoots: WORKSPACE_ROOTS,
    ...options,
  });
}

function assertFull(result) {
  assert.equal(result.mode, "full");
}

test("quality mode resolver returns the existing static-only, affected, and full classifications", () => {
  const staticGit = fakeGit({ files: ["docs/要件定義書.md"] });
  assert.equal(
    resolveQualityMode({
      env: QUALITY_RANGE_ENV,
      runGit: staticGit.runGit,
      workspaces: WORKSPACES,
    }).mode,
    "static-only",
  );

  const affectedGit = fakeGit();
  assert.equal(
    resolveQualityMode({
      env: QUALITY_RANGE_ENV,
      runGit: affectedGit.runGit,
      runTurbo: fakeTurbo().runTurbo,
      workspaces: WORKSPACES,
    }).mode,
    "affected",
  );

  const unsafeGit = fakeGit({ files: ["package.json"] });
  assert.equal(
    resolveQualityMode({
      env: QUALITY_RANGE_ENV,
      runGit: unsafeGit.runGit,
      workspaces: WORKSPACES,
    }).mode,
    "full",
  );
});

test("selects an ancestor workspace-only range", () => {
  const git = fakeGit();
  assert.deepEqual(resolve({ runGit: git.runGit }), {
    mode: "affected",
    base: "base",
    head: "head",
    files: ["apps/web/src/page.tsx"],
  });
  assert.ok(git.calls.some((args) => args[0] === "merge-base"));
});

test("falls back for missing, invalid, identical, or unrelated ranges", () => {
  assertFull(resolve({ runGit: fakeGit({ fail: ["rev-parse"] }).runGit }));
  assertFull(
    resolve({
      runGit: fakeGit({ ancestor: false }).runGit,
    }),
  );
  assertFull(
    resolve({
      runGit: fakeGit({
        commits: { HEAD: "same", base: "same", head: "same" },
      }).runGit,
    }),
  );
  assertFull(
    resolve({
      runGit: fakeGit({
        commits: { HEAD: "other", base: "base", head: "head" },
      }).runGit,
    }),
  );
});

test("falls back for Git failures, empty diffs, and working-tree changes", () => {
  assertFull(resolve({ runGit: fakeGit({ fail: ["diff"] }).runGit }));
  assertFull(resolve({ runGit: fakeGit({ files: [] }).runGit }));
  assertFull(
    resolve({
      runGit: fakeGit({ status: " M apps/web/src/page.tsx\0" }).runGit,
    }),
  );
  assertFull(
    resolve({
      runGit: fakeGit({ status: "?? file with\nnewline.txt\0" }).runGit,
    }),
  );
});

test("falls back for cross-workspace, unknown, and rename-crossing changes", () => {
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "turbo.json",
    "scripts/run-quality.mjs",
    "apps/web/package.json",
    "apps/unknown/src/index.ts",
  ]) {
    assertFull(resolve({ runGit: fakeGit({ files: [file] }).runGit }));
  }
});

test("classifies explicit non-runtime paths and docs-only changes as static-only", () => {
  for (const file of [
    "docs/要件定義書.md",
    "README.md",
    "CONTRIBUTING.md",
    "AGENTS.md",
    ".vscode/settings.json",
  ]) {
    assert.deepEqual(resolve({ runGit: fakeGit({ files: [file] }).runGit }), {
      mode: "static-only",
      reason: "runtime 非影響変更のみです",
    });
  }
});

test("filters non-runtime paths from mixed workspace runtime impact", () => {
  const result = resolve({
    runGit: fakeGit({
      files: ["apps/web/app/foo.tsx", "docs/要件定義書.md", "README.md"],
    }).runGit,
  });
  assert.equal(result.mode, "affected");
  assert.deepEqual(result.files, ["apps/web/app/foo.tsx"]);
});

test("mixed changes reach the runtime impact selector without docs paths", () => {
  const range = resolve({
    runGit: fakeGit({
      files: ["apps/web/app/foo.tsx", "docs/要件定義書.md"],
    }).runGit,
  });
  const turbo = fakeTurbo();
  const execution = resolveQualityExecution({
    range,
    runTurbo: turbo.runTurbo,
    workspaces: WORKSPACES,
  });
  assert.equal(execution.mode, "affected");
  assert.equal(execution.smallCommand, "test:small:affected");
});

test("falls back when non-runtime changes are mixed with unclassified or malformed paths", () => {
  for (const file of [
    "new-file.txt",
    "docs/../package.json",
    "docs\\guide.md",
    "/docs/guide.md",
    "docs//guide.md",
  ]) {
    assertFull(
      resolve({ runGit: fakeGit({ files: ["docs/guide.md", file] }).runGit }),
    );
  }
});

test("workspace package manifests remain global-impact even with non-runtime changes", () => {
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "turbo.json",
    "apps/web/package.json",
  ]) {
    assertFull(
      resolve({ runGit: fakeGit({ files: ["docs/guide.md", file] }).runGit }),
    );
  }
});

test("uses affected Turbo selections and forwards the same range", () => {
  const turbo = fakeTurbo();
  const runTurbo = (task, options) => {
    const result = turbo.runTurbo(task, options);
    const output = JSON.parse(result.stdout);
    output.tasks.unshift({ task: "build", package: "@repo/db" });
    return { ...result, stdout: JSON.stringify(output) };
  };
  const plan = resolveQualityExecution({
    range: {
      mode: "affected",
      base: "base",
      head: "head",
      files: ["apps/web/src/page.tsx"],
    },
    runTurbo,
    workspaces: WORKSPACES,
  });

  assert.equal(plan.mode, "affected");
  assert.equal(plan.smallCommand, "test:small:affected");
  assert.equal(plan.mediumCommand, "test:medium:affected");
  assert.deepEqual(plan.smallEnv, {
    TURBO_SCM_BASE: "base",
    TURBO_SCM_HEAD: "head",
  });
  assert.deepEqual(turbo.calls[0].options, {
    base: "base",
    head: "head",
    env: process.env,
  });
});

test("requires e2e in the affected Medium selection for web dependency impact", () => {
  const plan = resolveQualityExecution({
    range: {
      mode: "affected",
      base: "base",
      head: "head",
      files: ["packages/server/src/index.ts"],
    },
    runTurbo: fakeTurbo({ medium: ["server"] }).runTurbo,
    workspaces: WORKSPACES,
  });

  assert.equal(plan.mode, "affected");
  assert.equal(plan.smallCommand, "test:small:affected");
  assert.equal(plan.mediumCommand, "test:medium");
  assert.equal(plan.mediumEnv, undefined);
});

test("falls back when Turbo selection fails or is empty", () => {
  assertFull(
    resolveQualityExecution({
      range: {
        mode: "affected",
        base: "base",
        head: "head",
        files: ["apps/web/src/page.tsx"],
      },
      runTurbo: fakeTurbo({ fail: "test:small" }).runTurbo,
      workspaces: WORKSPACES,
    }),
  );
  assertFull(
    resolveQualityExecution({
      range: {
        mode: "affected",
        base: "base",
        head: "head",
        files: ["apps/web/src/page.tsx"],
      },
      runTurbo: fakeTurbo({ small: [] }).runTurbo,
      workspaces: WORKSPACES,
    }),
  );
  assertFull(
    resolveQualityExecution({
      range: {
        mode: "affected",
        base: "base",
        head: "head",
        files: ["apps/web/src/page.tsx"],
      },
      runTurbo(task, options) {
        if (task === "test:small") {
          return {
            status: 0,
            stdout: JSON.stringify({
              tasks: [{ task: "build", package: "@repo/db" }],
            }),
            stderr: "",
          };
        }
        return fakeTurbo().runTurbo(task, options);
      },
      workspaces: WORKSPACES,
    }),
  );
});

test("affected Quality always invokes the root small tests and keeps the gate summary names", () => {
  const executed = [];
  const output = [];
  const result = runQualityAffected({
    resolveRange() {
      return {
        mode: "affected",
        base: "base",
        head: "head",
        files: ["apps/web/src/page.tsx"],
      };
    },
    resolveExecution() {
      return {
        mode: "affected",
        base: "base",
        head: "head",
        reason: "test",
        smallCommand: "test:small:affected",
        mediumCommand: "test:medium:affected",
        smallEnv: { TURBO_SCM_BASE: "base", TURBO_SCM_HEAD: "head" },
        mediumEnv: { TURBO_SCM_BASE: "base", TURBO_SCM_HEAD: "head" },
      };
    },
    runCommand(command) {
      executed.push(command);
      return 0;
    },
    write(line) {
      output.push(line);
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(executed[6], "test:small:affected");
  assert.equal(executed[8], "build:storybook");
  assert.equal(executed[9], "test:medium:affected");
  assert.ok(output.some((line) => line.includes("Quality range: affected")));
  assert.ok(
    readFileSync(path.join(ROOT, "package.json"), "utf8").includes(
      '"test:small:affected": "node --test',
    ),
  );
});

test("affected Quality runs Storybook when impact classification falls back to full", () => {
  const executed = [];
  const result = runQualityAffected({
    resolveRange() {
      return { mode: "full", reason: "影響範囲を判定できません" };
    },
    runCommand(command) {
      executed.push(command);
      return 0;
    },
    write() {},
  });

  assert.equal(result.exitCode, 0);
  assert.ok(executed.includes("build:storybook"));
  assert.equal(
    result.results.find(({ name }) => name === "build:storybook").status,
    "PASS",
  );
});

test("E2E-only runtime changes keep Storybook in the affected quality run", () => {
  const executed = [];
  const turbo = fakeTurbo();
  const result = runQualityAffected({
    resolveRange() {
      return {
        mode: "affected",
        base: "base",
        head: "head",
        files: ["apps/e2e/tests/staff.medium.test.ts"],
      };
    },
    runTurbo: turbo.runTurbo,
    workspaces: WORKSPACES,
    runCommand(command) {
      executed.push(command);
      return 0;
    },
    write() {},
  });

  assert.equal(result.exitCode, 0);
  assert.ok(executed.includes("build:storybook"));
  assert.equal(
    result.results.find(({ name }) => name === "build:storybook").status,
    "PASS",
  );
});

test("static-only Quality runs root checks and skips runtime stages with reasons", () => {
  const executed = [];
  const output = [];
  const result = runQualityAffected({
    resolveRange() {
      return { mode: "static-only", reason: "runtime 非影響変更のみです" };
    },
    runCommand(command) {
      executed.push(command);
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
    "test:small:root",
  ]);
  assert.equal(result.exitCode, 0);
  for (const stage of [
    "typecheck",
    "build",
    "build:storybook",
    "test:medium",
  ]) {
    const summary = result.results.find(({ name }) => name === stage);
    assert.equal(summary.status, "SKIP");
    assert.match(summary.reason, /runtime 非影響変更のみ/u);
  }
  assert.ok(output.some((line) => line.includes("static-only")));
});

test("static-only Quality fails when an executed static check fails", () => {
  const result = runQualityAffected({
    resolveRange() {
      return { mode: "static-only", reason: "runtime 非影響変更のみです" };
    },
    runCommand(command) {
      return command === "spellcheck" ? 1 : 0;
    },
    write() {},
  });
  assert.equal(
    result.results.find(({ name }) => name === "spellcheck").status,
    "FAIL",
  );
  assert.equal(result.exitCode, 1);
});

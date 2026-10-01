import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuality } from "./run-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_GROUPS = ["apps", "packages"];
const E2E_WORKSPACE = "e2e";

function executeGit(args, { cwd = ROOT } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function executeTurbo(task, { base, head, env = process.env } = {}) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    pnpm,
    [
      "exec",
      "turbo",
      "run",
      task,
      "--affected",
      "--dry=json",
      "--concurrency=1",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        TURBO_SCM_BASE: base,
        TURBO_SCM_HEAD: head,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function commandSucceeded(result) {
  return !result?.error && result?.status === 0;
}

function commandFailureReason(label, result) {
  if (result?.error?.message) return `${label}: ${result.error.message}`;
  const detail = result?.stderr?.trim();
  return detail ? `${label}: ${detail}` : `${label}: コマンドが失敗しました`;
}

function runGitSafely(runGit, args) {
  try {
    return runGit(args);
  } catch (error) {
    return {
      status: null,
      stdout: "",
      stderr: "",
      error,
    };
  }
}

function resolveCommit(runGit, ref) {
  const result = runGitSafely(runGit, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]);
  if (!commandSucceeded(result)) {
    return {
      ok: false,
      reason: commandFailureReason(`commit ${ref} の解決`, result),
    };
  }

  const value = result.stdout.trim();
  return value
    ? { ok: true, value }
    : { ok: false, reason: `commit ${ref} の解決結果が空です` };
}

export function discoverWorkspaces(root = ROOT) {
  const workspaces = [];

  for (const group of WORKSPACE_GROUPS) {
    const groupPath = path.join(root, group);
    let entries;
    try {
      entries = readdirSync(groupPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceRoot = `${group}/${entry.name}`;
      const manifestPath = path.join(groupPath, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (typeof manifest.name !== "string" || !manifest.name) continue;
        workspaces.push({
          root: workspaceRoot,
          name: manifest.name,
          manifest,
        });
      } catch {
        return null;
      }
    }
  }

  return workspaces;
}

export function discoverWorkspaceRoots(root = ROOT) {
  return (discoverWorkspaces(root) ?? []).map(
    ({ root: workspaceRoot }) => workspaceRoot,
  );
}

export function collectGitSnapshot({
  runGit = executeGit,
  env = process.env,
} = {}) {
  const baseInput = env.TURBO_SCM_BASE?.trim() ?? "";
  const headInput = env.TURBO_SCM_HEAD?.trim() ?? "";
  const hasBase = Boolean(baseInput);
  const hasHead = Boolean(headInput);
  const status = runGitSafely(runGit, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const currentHead = resolveCommit(runGit, "HEAD");

  if (hasBase !== hasHead) {
    return {
      status,
      currentHead,
      range: {
        base: {
          ok: false,
          reason: "TURBO_SCM_BASE と TURBO_SCM_HEAD は両方指定してください",
        },
        head: {
          ok: false,
          reason: "TURBO_SCM_BASE と TURBO_SCM_HEAD は両方指定してください",
        },
      },
    };
  }

  if (hasBase && hasHead) {
    return {
      status,
      currentHead,
      range: {
        base: resolveCommit(runGit, baseInput),
        head: resolveCommit(runGit, headInput),
      },
    };
  }

  const originDevelop = resolveCommit(runGit, "refs/remotes/origin/develop");
  let base = {
    ok: false,
    reason: "origin/develop を解決できません",
  };

  if (originDevelop.ok && currentHead.ok) {
    const mergeBase = runGitSafely(runGit, [
      "merge-base",
      originDevelop.value,
      currentHead.value,
    ]);
    if (commandSucceeded(mergeBase) && mergeBase.stdout.trim()) {
      base = resolveCommit(runGit, mergeBase.stdout.trim());
    } else {
      base = {
        ok: false,
        reason: commandFailureReason(
          "origin/develop との merge-base 解決",
          mergeBase,
        ),
      };
    }
  }

  return {
    status,
    currentHead,
    range: { base, head: currentHead },
  };
}

function getAncestorResult(runGit, base, head) {
  const result = runGitSafely(runGit, [
    "merge-base",
    "--is-ancestor",
    base,
    head,
  ]);
  if (result.status === 0 && !result.error) return { ok: true, value: true };
  if (result.status === 1 && !result.error) {
    return { ok: true, value: false };
  }
  return {
    ok: false,
    reason: commandFailureReason("比較元が比較先の祖先かの確認", result),
  };
}

function getDiffResult(runGit, base, head) {
  const result = runGitSafely(runGit, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    base,
    head,
    "--",
  ]);
  if (!commandSucceeded(result)) {
    return {
      ok: false,
      reason: commandFailureReason("比較差分の取得", result),
    };
  }

  return {
    ok: true,
    files: result.stdout.split("\0").filter(Boolean),
  };
}

function isSafeWorkspaceFile(file, workspaceRoots) {
  if (!isSafeRelativePath(file)) return false;

  const workspaceRoot = workspaceRoots.find((root) =>
    file.startsWith(`${root}/`),
  );
  if (!workspaceRoot) return false;
  return file !== `${workspaceRoot}/package.json`;
}

function isSafeRelativePath(file) {
  if (!file || file.startsWith("/") || file.includes("\\")) return false;
  const normalized = path.posix.normalize(file);
  return normalized === file && !normalized.startsWith("../");
}

function isNonRuntimeFile(file) {
  if (!isSafeRelativePath(file)) return false;
  return (
    file.startsWith("docs/") ||
    ["README.md", "CONTRIBUTING.md", "AGENTS.md"].includes(file) ||
    file.startsWith(".vscode/")
  );
}

export function determineAffectedRange({
  snapshot,
  workspaceRoots = (discoverWorkspaces() ?? []).map(({ root }) => root),
} = {}) {
  if (!snapshot) {
    return { mode: "full", reason: "比較範囲の Git 状態がありません" };
  }
  if (!commandSucceeded(snapshot.status)) {
    return {
      mode: "full",
      reason: commandFailureReason("git status", snapshot.status),
    };
  }
  if (snapshot.status.stdout) {
    return {
      mode: "full",
      reason: "未コミットの変更または未追跡ファイルがあります",
    };
  }
  if (!snapshot.currentHead.ok) {
    return { mode: "full", reason: snapshot.currentHead.reason };
  }
  if (!snapshot.range.base.ok) {
    return { mode: "full", reason: snapshot.range.base.reason };
  }
  if (!snapshot.range.head.ok) {
    return { mode: "full", reason: snapshot.range.head.reason };
  }

  const { base, head } = snapshot.range;
  if (head.value !== snapshot.currentHead.value) {
    return {
      mode: "full",
      reason: "比較先が現在 checkout されている HEAD と一致しません",
    };
  }
  if (base.value === head.value) {
    return { mode: "full", reason: "比較元と比較先が同一です" };
  }

  if (!snapshot.ancestor?.ok) {
    return {
      mode: "full",
      reason: snapshot.ancestor?.reason ?? "祖先関係を確認できません",
    };
  }
  if (!snapshot.ancestor.value) {
    return { mode: "full", reason: "比較元が比較先の祖先ではありません" };
  }
  if (!snapshot.diff?.ok) {
    return {
      mode: "full",
      reason: snapshot.diff?.reason ?? "比較差分を取得できません",
    };
  }
  if (snapshot.diff.files.length === 0) {
    return { mode: "full", reason: "比較差分が空です" };
  }

  const files = snapshot.diff.files;
  const runtimeFiles = files.filter((file) => !isNonRuntimeFile(file));
  if (runtimeFiles.length === 0) {
    return { mode: "static-only", reason: "runtime 非影響変更のみです" };
  }

  const unsafeFile = runtimeFiles.find(
    (file) => !isSafeWorkspaceFile(file, workspaceRoots),
  );
  if (unsafeFile) {
    return {
      mode: "full",
      reason: `workspace の影響範囲を限定できない変更があります: ${unsafeFile}`,
    };
  }

  return {
    mode: "affected",
    base: base.value,
    head: head.value,
    files: runtimeFiles,
  };
}

export function resolveQualityRange({
  env = process.env,
  runGit = executeGit,
  workspaceRoots = (discoverWorkspaces() ?? []).map(({ root }) => root),
} = {}) {
  try {
    const snapshot = collectGitSnapshot({ runGit, env });
    if (snapshot.range.base.ok && snapshot.range.head.ok) {
      snapshot.ancestor = getAncestorResult(
        runGit,
        snapshot.range.base.value,
        snapshot.range.head.value,
      );
      if (snapshot.ancestor.ok && snapshot.ancestor.value) {
        snapshot.diff = getDiffResult(
          runGit,
          snapshot.range.base.value,
          snapshot.range.head.value,
        );
      }
    }
    return determineAffectedRange({ snapshot, workspaceRoots });
  } catch (error) {
    return {
      mode: "full",
      reason: `比較範囲の解決に失敗しました: ${error.message}`,
    };
  }
}

function workspaceDependencies(workspace) {
  return new Set(
    Object.keys({
      ...workspace.manifest.dependencies,
      ...workspace.manifest.devDependencies,
      ...workspace.manifest.optionalDependencies,
      ...workspace.manifest.peerDependencies,
    }),
  );
}

function hasE2eImpact(files, workspaces) {
  const byRoot = new Map(
    workspaces.map((workspace) => [workspace.root, workspace]),
  );
  const byName = new Map(
    workspaces.map((workspace) => [workspace.name, workspace]),
  );
  const reverseDependencies = new Map(
    workspaces.map((workspace) => [workspace.root, new Set()]),
  );
  const changedRoots = new Set();

  for (const file of files) {
    const workspace = workspaces.find((candidate) =>
      file.startsWith(`${candidate.root}/`),
    );
    if (!workspace) throw new Error(`workspace を特定できません: ${file}`);
    changedRoots.add(workspace.root);
  }

  for (const workspace of workspaces) {
    for (const dependency of workspaceDependencies(workspace)) {
      const target = byName.get(dependency);
      if (target) reverseDependencies.get(target.root).add(workspace.root);
    }
  }

  const impactedRoots = new Set(changedRoots);
  const queue = [...changedRoots];
  while (queue.length > 0) {
    const root = queue.shift();
    for (const dependent of reverseDependencies.get(root) ?? []) {
      if (impactedRoots.has(dependent)) continue;
      impactedRoots.add(dependent);
      queue.push(dependent);
    }
  }

  return [...impactedRoots].some((root) => {
    const name = byRoot.get(root)?.name;
    return (
      name === E2E_WORKSPACE ||
      name === "web" ||
      name === "@repo/server" ||
      name === "@repo/db"
    );
  });
}

function parseTurboTasks(result, expectedTask) {
  if (!commandSucceeded(result)) {
    return {
      ok: false,
      reason: commandFailureReason(
        `Turbo ${expectedTask} affected 選択`,
        result,
      ),
    };
  }

  let output;
  try {
    output = result.json ?? JSON.parse(result.stdout.trim());
  } catch (error) {
    return {
      ok: false,
      reason: `Turbo ${expectedTask} affected 選択結果を解釈できません: ${error.message}`,
    };
  }

  if (!Array.isArray(output?.tasks) || output.tasks.length === 0) {
    return {
      ok: false,
      reason: `Turbo ${expectedTask} affected の実行対象がありません`,
    };
  }

  const tasks = output.tasks.map((task) => {
    const packageName =
      task.package ??
      task.packageName ??
      (typeof task.taskId === "string"
        ? task.taskId.split("#")[0]
        : typeof task.id === "string"
          ? task.id.split("#")[0]
          : "");
    const taskName =
      task.task ??
      (typeof task.taskId === "string"
        ? task.taskId.split("#")[1]
        : typeof task.id === "string"
          ? task.id.split("#")[1]
          : "");
    return { packageName, taskName };
  });
  const selectedTasks = tasks.filter(
    ({ taskName }) => taskName === expectedTask,
  );
  if (selectedTasks.length === 0) {
    return {
      ok: false,
      reason: `Turbo ${expectedTask} affected の実行対象がありません`,
    };
  }
  if (selectedTasks.some(({ packageName }) => !packageName)) {
    return {
      ok: false,
      reason: `Turbo ${expectedTask} affected の実行対象を検証できません`,
    };
  }

  return { ok: true, tasks: selectedTasks };
}

export function selectAffectedTasks({
  task,
  base,
  head,
  runTurbo = executeTurbo,
  env = process.env,
} = {}) {
  try {
    return parseTurboTasks(runTurbo(task, { base, head, env }), task);
  } catch (error) {
    return {
      ok: false,
      reason: `Turbo ${task} affected 選択に失敗しました: ${error.message}`,
    };
  }
}

export function resolveQualityExecution({
  range,
  runTurbo = executeTurbo,
  env = process.env,
  workspaces = discoverWorkspaces(),
} = {}) {
  if (range?.mode !== "affected") {
    if (range?.mode === "static-only") {
      return { mode: "static-only", reason: range.reason };
    }
    return {
      mode: "full",
      reason: range?.reason ?? "差分範囲を安全に限定できません",
    };
  }

  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return {
      mode: "full",
      reason: "workspace の依存関係を確認できません",
    };
  }

  const testEnv = {
    TURBO_SCM_BASE: range.base,
    TURBO_SCM_HEAD: range.head,
  };
  const small = selectAffectedTasks({
    task: "test:small",
    base: range.base,
    head: range.head,
    runTurbo,
    env,
  });
  const medium = selectAffectedTasks({
    task: "test:medium",
    base: range.base,
    head: range.head,
    runTurbo,
    env,
  });

  if (!small.ok || !medium.ok) {
    return {
      mode: "full",
      reason: small.ok ? medium.reason : small.reason,
    };
  }

  let e2eImpact;
  try {
    e2eImpact = hasE2eImpact(range.files, workspaces);
  } catch (error) {
    return {
      mode: "full",
      reason: `workspace の影響範囲を確認できません: ${error.message}`,
    };
  }

  const e2eSelected = medium.tasks.some(
    ({ packageName }) =>
      packageName === E2E_WORKSPACE ||
      packageName.endsWith(`/${E2E_WORKSPACE}`),
  );
  if (e2eImpact && !e2eSelected) {
    return {
      mode: "affected",
      reason:
        "Web・Server・DBの影響に対するe2e選択を保証できないためMediumを全件実行します",
      smallCommand: "test:small:affected",
      mediumCommand: "test:medium",
      smallEnv: testEnv,
      mediumEnv: undefined,
      base: range.base,
      head: range.head,
    };
  }

  return {
    mode: "affected",
    reason: "Turbo affected のSmall/Medium実行対象を検証しました",
    smallCommand: "test:small:affected",
    mediumCommand: "test:medium:affected",
    smallEnv: testEnv,
    mediumEnv: testEnv,
    base: range.base,
    head: range.head,
  };
}

export function resolveQualityMode({
  runGit = executeGit,
  runTurbo = executeTurbo,
  env = process.env,
  resolveRange = resolveQualityRange,
  resolveExecution = resolveQualityExecution,
  workspaces = discoverWorkspaces(),
} = {}) {
  let range;
  try {
    range = resolveRange({ env, runGit });
  } catch (error) {
    range = {
      mode: "full",
      reason: `比較範囲の解決に失敗しました: ${error.message}`,
    };
  }

  let execution;
  try {
    execution = resolveExecution({
      range,
      runTurbo,
      env,
      workspaces,
    });
  } catch (error) {
    execution = {
      mode: "full",
      reason: `影響範囲のテスト選択に失敗しました: ${error.message}`,
    };
  }

  return execution;
}

export function runQualityAffected({
  runGit = executeGit,
  runTurbo = executeTurbo,
  runCommand,
  write = console.log,
  env = process.env,
  resolveRange = resolveQualityRange,
  resolveExecution = resolveQualityExecution,
  workspaces = discoverWorkspaces(),
} = {}) {
  const execution = resolveQualityMode({
    runGit,
    runTurbo,
    env,
    resolveRange,
    resolveExecution,
    workspaces,
  });

  if (execution.mode === "affected") {
    write(
      `Quality range: affected: ${execution.base} -> ${execution.head} (${execution.reason})`,
    );
  } else if (execution.mode !== "static-only") {
    write(`Quality range: full: ${execution.reason}`);
  }

  if (execution.mode === "static-only") {
    write(`Quality range: static-only (${execution.reason})`);
  }

  return runQuality({
    runCommand,
    write,
    mediumCommand: execution.mediumCommand ?? "test:medium",
    smallEnv: execution.smallEnv,
    mediumEnv: execution.mediumEnv,
    skippedStages:
      execution.mode === "static-only"
        ? {
            typecheck: "runtime 非影響変更のみのため省略",
            build: "runtime 非影響変更のみのため省略",
            "build:storybook": "runtime 非影響変更のみのため省略",
            "test:medium": "runtime 非影響変更のみのため省略",
          }
        : undefined,
    smallCommand:
      execution.mode === "static-only"
        ? "test:small:root"
        : (execution.smallCommand ?? "test:small"),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--mode")) {
    process.stdout.write(`${resolveQualityMode().mode}\n`);
  } else {
    process.exitCode = runQualityAffected().exitCode;
  }
}

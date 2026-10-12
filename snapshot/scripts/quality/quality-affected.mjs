import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuality } from "./run-quality.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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
    return { status: null, stdout: "", stderr: "", error };
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

function collectGitSnapshot({ runGit = executeGit, env = process.env } = {}) {
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
    const invalid = {
      ok: false,
      reason: "TURBO_SCM_BASE と TURBO_SCM_HEAD は両方指定してください",
    };
    return { status, currentHead, range: { base: invalid, head: invalid } };
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
  let base = { ok: false, reason: "origin/develop を解決できません" };
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
  return { status, currentHead, range: { base, head: currentHead } };
}

function getAncestorResult(runGit, base, head) {
  const result = runGitSafely(runGit, [
    "merge-base",
    "--is-ancestor",
    base,
    head,
  ]);
  if (result.status === 0 && !result.error) return { ok: true, value: true };
  if (result.status === 1 && !result.error) return { ok: true, value: false };
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
  return { ok: true, files: result.stdout.split("\0").filter(Boolean) };
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

export function determineAffectedRange({ snapshot } = {}) {
  if (!snapshot)
    return { mode: "full", reason: "比較範囲の Git 状態がありません" };
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
  if (!snapshot.currentHead.ok)
    return { mode: "full", reason: snapshot.currentHead.reason };
  if (!snapshot.range.base.ok)
    return { mode: "full", reason: snapshot.range.base.reason };
  if (!snapshot.range.head.ok)
    return { mode: "full", reason: snapshot.range.head.reason };

  const { base, head } = snapshot.range;
  if (head.value !== snapshot.currentHead.value) {
    return {
      mode: "full",
      reason: "比較先が現在 checkout されている HEAD と一致しません",
    };
  }
  if (base.value === head.value)
    return { mode: "full", reason: "比較元と比較先が同一です" };
  if (!snapshot.ancestor?.ok) {
    return {
      mode: "full",
      reason: snapshot.ancestor?.reason ?? "祖先関係を確認できません",
    };
  }
  if (!snapshot.ancestor.value)
    return { mode: "full", reason: "比較元が比較先の祖先ではありません" };
  if (!snapshot.diff?.ok) {
    return {
      mode: "full",
      reason: snapshot.diff?.reason ?? "比較差分を取得できません",
    };
  }
  if (snapshot.diff.files.length === 0)
    return { mode: "full", reason: "比較差分が空です" };

  const files = snapshot.diff.files;
  const runtimeFiles = files.filter((file) => !isNonRuntimeFile(file));
  if (runtimeFiles.length === 0)
    return { mode: "static-only", reason: "runtime 非影響変更のみです" };
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
    return determineAffectedRange({ snapshot });
  } catch (error) {
    return {
      mode: "full",
      reason: `比較範囲の解決に失敗しました: ${error.message}`,
    };
  }
}

export function resolveQualityExecution({ range } = {}) {
  if (range?.mode === "static-only")
    return { mode: "static-only", reason: range.reason };
  if (range?.mode !== "affected") {
    return {
      mode: "full",
      reason: range?.reason ?? "差分範囲を安全に限定できません",
    };
  }
  const testEnv = { TURBO_SCM_BASE: range.base, TURBO_SCM_HEAD: range.head };
  return {
    mode: "affected",
    reason: "Turbo が affected workspace tests を選択します",
    smallCommand: "node scripts/quality/run-affected-tests.mjs small",
    mediumCommand: "node scripts/quality/run-affected-tests.mjs medium",
    smallEnv: testEnv,
    mediumEnv: testEnv,
    base: range.base,
    head: range.head,
  };
}

export function resolveQualityMode({
  runGit = executeGit,
  env = process.env,
  resolveRange = resolveQualityRange,
  resolveExecution = resolveQualityExecution,
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
  try {
    return resolveExecution({ range });
  } catch (error) {
    return {
      mode: "full",
      reason: `影響範囲のテスト選択に失敗しました: ${error.message}`,
    };
  }
}

export function runQualityAffected({
  runGit = executeGit,
  runCommand,
  write = console.log,
  env = process.env,
  resolveRange = resolveQualityRange,
  resolveExecution = resolveQualityExecution,
} = {}) {
  const execution = resolveQualityMode({
    runGit,
    env,
    resolveRange,
    resolveExecution,
  });
  if (execution.mode === "affected") {
    write(
      `Quality range: affected: ${execution.base} -> ${execution.head} (${execution.reason})`,
    );
  } else if (execution.mode === "static-only") {
    write(`Quality range: static-only (${execution.reason})`);
  } else {
    write(`Quality range: full: ${execution.reason}`);
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
            "test:small": "runtime 非影響変更のみのため省略",
            build: "runtime 非影響変更のみのため省略",
            "build:storybook": "runtime 非影響変更のみのため省略",
            "test:medium": "runtime 非影響変更のみのため省略",
          }
        : undefined,
    smallCommand: execution.smallCommand ?? "test:small",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--mode")) {
    process.stdout.write(`${resolveQualityMode().mode}\n`);
  } else {
    process.exitCode = runQualityAffected().exitCode;
  }
}

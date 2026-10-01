import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function lintCommitMessage(message, { editPath, run = spawnSync } = {}) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const commitlintArgs = ["exec", "commitlint", "--verbose"];
  if (editPath) {
    commitlintArgs.push("--edit", editPath);
  }
  let failed = false;

  const commitlint = run(pnpm, commitlintArgs, {
    cwd: ROOT,
    input: editPath ? undefined : message,
    stdio: editPath ? "inherit" : ["pipe", "inherit", "inherit"],
  });
  if (commitlint.error) {
    console.error(commitlint.error);
  }
  if (commitlint.error || commitlint.status !== 0) {
    failed = true;
  }

  let textlintInput = message;
  if (editPath) {
    // Git's default commit cleanup strips comment lines using core.commentChar.
    const cleaned = run("git", ["stripspace", "--strip-comments"], {
      cwd: ROOT,
      input: message,
      encoding: "utf8",
    });
    if (cleaned.error) {
      console.error(cleaned.error);
    }
    if (cleaned.error || cleaned.status !== 0) {
      if (cleaned.stderr) {
        console.error(cleaned.stderr.trimEnd());
      }
      return 1;
    }
    textlintInput = cleaned.stdout;
  }

  const textlint = run(
    pnpm,
    ["exec", "textlint", "--stdin", "--stdin-filename", "commit-message.md"],
    {
      cwd: ROOT,
      input: textlintInput,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (textlint.error) {
    console.error(textlint.error);
  }
  if (textlint.error || textlint.status !== 0) {
    failed = true;
  }

  return failed ? 1 : 0;
}

export function readCommitMessage(args, { readFile = readFileSync } = {}) {
  if (args.length === 0) {
    return { message: readFile(0, "utf8") };
  }
  if (args.length === 2 && args[0] === "--edit" && args[1]) {
    return { message: readFile(args[1], "utf8"), editPath: args[1] };
  }
  throw new Error("Usage: lint-commit-message.mjs [--edit <file>]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { message, editPath } = readCommitMessage(process.argv.slice(2));
    process.exitCode = lintCommitMessage(message, { editPath });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

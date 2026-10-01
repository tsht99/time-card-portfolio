import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PUSH_COMMITS = 2048;

export function parsePushPayload(payload) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("GitHub push event payload must be an object");
  }

  if (!Array.isArray(payload.commits)) {
    throw new Error("GitHub push event payload commits must be an array");
  }

  if (payload.commits.length >= MAX_PUSH_COMMITS) {
    throw new Error(
      "GitHub push event payload contains 2048 or more commits; the complete commit set cannot be guaranteed",
    );
  }

  for (const [index, commit] of payload.commits.entries()) {
    if (
      commit === null ||
      typeof commit !== "object" ||
      Array.isArray(commit) ||
      typeof commit.message !== "string"
    ) {
      throw new Error(
        `GitHub push event commit at index ${index} has no string message`,
      );
    }
  }

  return payload.commits.map(({ message }) => message);
}

function runCommitMessageLint(message) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["lint:commit"], {
    cwd: ROOT,
    input: message,
    stdio: ["pipe", "inherit", "inherit"],
  });

  return result.error || result.status !== 0 ? 1 : 0;
}

export function lintPushCommits(
  messages,
  { lintRunner = runCommitMessageLint, write = console.error } = {},
) {
  let failed = false;

  for (const [index, message] of messages.entries()) {
    const exitCode = lintRunner(message, index);
    if (exitCode !== 0) {
      failed = true;
      write(`commit message lint failed for pushed commit at index ${index}`);
    }
  }

  return failed ? 1 : 0;
}

export function readPushEventPayload(
  eventPath,
  { readFile = readFileSync } = {},
) {
  if (typeof eventPath !== "string" || eventPath.length === 0) {
    throw new Error("GITHUB_EVENT_PATH is required");
  }

  const contents = readFile(eventPath, "utf8");
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error("GitHub push event payload is not valid JSON", {
      cause: error,
    });
  }
}

export function runPushCommitLint({
  eventPath,
  readFile = readFileSync,
  lintRunner = runCommitMessageLint,
  write = console.error,
} = {}) {
  const payload = readPushEventPayload(eventPath, { readFile });
  const messages = parsePushPayload(payload);
  return lintPushCommits(messages, { lintRunner, write });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const environment = process.env;
    process.exitCode = runPushCommitLint({
      eventPath: environment.GITHUB_EVENT_PATH,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

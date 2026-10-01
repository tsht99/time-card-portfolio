import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const READ_ONLY_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "grep",
  "ls",
  "wc",
  "stat",
  "cmp",
  "diff",
  "cksum",
  "shasum",
  "sha256sum",
  "md5",
  "strings",
  "od",
  "hexdump",
  "nl",
  "cut",
  "fold",
  "fmt",
  "readlink",
  "realpath",
  "du",
  "pwd",
]);
const GENERATE_COMMAND = /^pnpm --filter @repo\/db generate(?: +[^\s]+)*$/;
const GENERATE_ATTEMPT =
  /\b(?:drizzle-kit\s+generate|generate-migration\.mjs|pnpm\s+--filter\s+@repo\/db\s+(?:run\s+)?generate)\b/;
const UNSAFE_SHELL_SYNTAX = /[;&|><`$(){}[\]*?!~\\'"\r\n]/;
const UNSAFE_GIT_PATH = /[*?[]|^:/;
const PATH_FIELDS =
  /^(?:path|paths|file|files|filename|filepath|file_path|directory|dir|destination|dest|source|src|target|from|to|old_path|new_path|source_path|destination_path|target_path|input_path|output_path|workdir|cwd|command|cmd|args|arguments)$/i;
const DESCRIPTION_FIELDS =
  /^(?:prompt|description|message|text|instructions|title|summary)$/i;

function within(candidate, directory) {
  return (
    candidate === directory || candidate.startsWith(`${directory}${path.sep}`)
  );
}

function existingRealpath(candidate) {
  let parent = candidate;
  const remainder = [];
  for (;;) {
    try {
      return path.resolve(realpathSync(parent), ...remainder.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      remainder.push(path.basename(parent));
      parent = next;
    }
  }
}

function migrationPath(candidate, root, cwd) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const protectedPath = path.join(root, "packages/db/migrations");
  const realProtectedPath = existingRealpath(protectedPath);
  const bases = path.isAbsolute(candidate)
    ? [candidate]
    : [path.resolve(cwd, candidate), path.resolve(root, candidate)];
  return bases.some(
    (base) =>
      within(base, protectedPath) ||
      within(existingRealpath(base), realProtectedPath),
  );
}

function commandTouchesMigration(command, root, cwd) {
  if (migrationPath(cwd, root, cwd)) return true;
  // Split only for detection. A command with shell syntax is never allowed after detection.
  const fragments =
    command.replace(/['"\\]/g, "").match(/[A-Za-z0-9_./@:-]+/g) ?? [];
  // A shell can change directory before using a relative migration path.
  if (
    UNSAFE_SHELL_SYNTAX.test(command) &&
    fragments.some(
      (fragment) =>
        fragment === "migrations" || fragment.startsWith("migrations/"),
    ) &&
    (fragments.some((fragment) => fragment.includes("packages/db")) ||
      (fragments.includes("packages") && fragments.includes("db")))
  )
    return true;
  return fragments.some((fragment) => {
    if (migrationPath(fragment, root, cwd)) return true;
    const repositoryPath = fragment.indexOf("packages/db/");
    return (
      repositoryPath > 0 &&
      migrationPath(fragment.slice(repositoryPath), root, cwd)
    );
  });
}

function patchTouchesMigration(patch, root, cwd) {
  const directives =
    /^\*\*\* (?:Add File|Update File|Delete File|Move to|Rename to):[ \t]*(.+)$/gm;
  for (const match of patch.matchAll(directives)) {
    if (migrationPath(match[1].trim(), root, cwd)) return true;
  }
  return false;
}

function explicitMigrationFiles(command, root, cwd) {
  if (UNSAFE_SHELL_SYNTAX.test(command)) return null;
  const words = command.trim().split(/ +/);
  const args =
    words[0] === "git" && words[1] === "add" && words[2] === "--"
      ? words.slice(3)
      : words[0] === "git" &&
          words[1] === "restore" &&
          words[2] === "--staged" &&
          words[3] === "--"
        ? words.slice(4)
        : null;
  if (!args?.length || args.some((arg) => !arg || UNSAFE_GIT_PATH.test(arg)))
    return null;
  const protectedPath = path.join(root, "packages/db/migrations");
  const realProtectedPath = existingRealpath(protectedPath);
  for (const arg of args) {
    const absolute = path.isAbsolute(arg) ? arg : path.resolve(cwd, arg);
    try {
      if (
        !within(absolute, protectedPath) ||
        !within(existingRealpath(absolute), realProtectedPath) ||
        !lstatSync(absolute).isFile()
      )
        return null;
    } catch {
      return null;
    }
  }
  return args;
}

function broadGitMigrationOperation(command) {
  if (UNSAFE_SHELL_SYNTAX.test(command)) return false;
  const words = command.trim().split(/ +/);
  return (
    (words[0] === "git" &&
      words[1] === "add" &&
      words
        .slice(2)
        .some((arg) =>
          ["-A", "--all", "-u", "--update", ".", ".."].includes(arg),
        )) ||
    (words[0] === "git" &&
      words[1] === "restore" &&
      words[2] === "--staged" &&
      words.length === 3)
  );
}

function gitMayTouchMigration(command, root, cwd) {
  const words = command.trim().split(/ +/);
  if (words[0] !== "git" || !["add", "restore"].includes(words[1]))
    return false;
  if (broadGitMigrationOperation(command)) return true;
  const protectedPath = path.join(root, "packages/db/migrations");
  const args = words.slice(words.indexOf("--") + 1);
  return args.some((arg) => {
    if (!arg || UNSAFE_GIT_PATH.test(arg)) return true;
    const candidate = path.resolve(cwd, arg);
    return (
      migrationPath(arg, root, cwd) ||
      within(protectedPath, candidate) ||
      within(existingRealpath(protectedPath), existingRealpath(candidate))
    );
  });
}

function otherToolTouchesMigration(value, root, cwd, key = "") {
  if (Array.isArray(value))
    return value.some((item) =>
      otherToolTouchesMigration(item, root, cwd, key),
    );
  if (value && typeof value === "object") {
    return Object.entries(value).some(([field, item]) => {
      if (DESCRIPTION_FIELDS.test(field)) return false;
      return otherToolTouchesMigration(item, root, cwd, field);
    });
  }
  if (typeof value === "string" && key === "patch")
    return patchTouchesMigration(value, root, cwd);
  if (typeof value !== "string" || !PATH_FIELDS.test(key)) return false;
  if (
    key.toLowerCase() === "command" ||
    key.toLowerCase() === "cmd" ||
    key.toLowerCase() === "args" ||
    key.toLowerCase() === "arguments"
  ) {
    if (GENERATE_COMMAND.test(value) && !UNSAFE_SHELL_SYNTAX.test(value))
      return false;
    return (
      GENERATE_ATTEMPT.test(value) || commandTouchesMigration(value, root, cwd)
    );
  }
  return migrationPath(value, root, cwd);
}

export function evaluateMigrationAccess(
  input,
  { root = REPOSITORY_ROOT, cwd = process.cwd() } = {},
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.tool_name !== "string" ||
    !input.tool_input ||
    typeof input.tool_input !== "object" ||
    Array.isArray(input.tool_input)
  ) {
    return "Malformed tool invocation";
  }

  const tool = input.tool_name;
  const parameters = input.tool_input;
  const sessionCwd = input.cwd ?? parameters.workdir ?? parameters.cwd ?? cwd;
  if (typeof sessionCwd !== "string") return "Invalid working directory";
  const resolvedCwd = path.resolve(sessionCwd);
  const resolvedRoot = path.resolve(root);

  if (tool === "apply_patch") {
    const patch = parameters.command;
    if (typeof patch !== "string") return "Invalid patch input";
    return patchTouchesMigration(patch, resolvedRoot, resolvedCwd)
      ? "Refused direct migration file creation, editing, deletion, or move; change the schema and run the canonical pnpm --filter @repo/db generate -- <migration-name> command."
      : null;
  }

  if (tool === "Bash") {
    const command = parameters.command;
    if (typeof command !== "string") return "Invalid Bash command";
    if (GENERATE_COMMAND.test(command) && !UNSAFE_SHELL_SYNTAX.test(command))
      return null;
    if (GENERATE_ATTEMPT.test(command))
      return "Refused a non-canonical migration generator command; change the schema and run pnpm --filter @repo/db generate -- <migration-name>. If the command cannot be classified, stop and report it.";
    if (
      !commandTouchesMigration(command, resolvedRoot, resolvedCwd) &&
      !gitMayTouchMigration(command, resolvedRoot, resolvedCwd)
    )
      return null;
    if (explicitMigrationFiles(command, resolvedRoot, resolvedCwd)) return null;
    if (broadGitMigrationOperation(command))
      return "Refused broad Git staging or restore that could include migration files; stage only with git add -- <explicit migration file> or restore only with git restore --staged -- <explicit migration file>. If uncertain, stop and report it.";
    if (UNSAFE_SHELL_SYNTAX.test(command))
      return "Refused migration access with shell expansion or command chaining; run only the canonical generator or git add -- with explicit migration files. If the command cannot be classified, stop and report it.";
    const words = command.trim().split(/\s+/);
    if (!READ_ONLY_COMMANDS.has(words[0]))
      return "Refused migration write or Git operation outside the safe allowlist; use git add -- <explicit migration file> (or git restore --staged -- <explicit migration file>) after generation. For schema changes, run pnpm --filter @repo/db generate -- <migration-name>. If uncertain, stop and report it.";
    return null;
  }

  return otherToolTouchesMigration(parameters, resolvedRoot, resolvedCwd)
    ? "Refused access to packages/db/migrations because this tool cannot be verified as read-only; stop and report the tool and requested path for review."
    : null;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let input = "";
  try {
    for await (const chunk of process.stdin) input += chunk;
    const reason = evaluateMigrationAccess(JSON.parse(input));
    if (reason) {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        })}\n`,
      );
    }
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "Refused the invocation because the guard could not evaluate it; access to packages/db/migrations cannot be verified. Stop and report the invocation for review.",
        },
      })}\n`,
    );
  }
}

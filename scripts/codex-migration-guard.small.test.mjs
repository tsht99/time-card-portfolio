import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateMigrationAccess } from "../.codex/hooks/migration-guard.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "timecard-migration-guard-"));
const migrationDirectory = path.join(root, "packages/db/migrations");
const migrationFile = path.join(migrationDirectory, "0001.sql");
const secondMigrationFile = path.join(migrationDirectory, "0002.sql");
const hook = fileURLToPath(
  new URL("../.codex/hooks/migration-guard.mjs", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(migrationDirectory, { recursive: true });
writeFileSync(migrationFile, "CREATE TABLE example (id int);\n");
writeFileSync(
  secondMigrationFile,
  "ALTER TABLE example ADD COLUMN value int;\n",
);
after(() => rmSync(root, { recursive: true, force: true }));

const check = (tool_name, tool_input, cwd = root) =>
  evaluateMigrationAccess({ tool_name, tool_input }, { root, cwd });

test("unrelated Bash and patches do not block", () => {
  assert.equal(check("Bash", { command: "node --version" }), null);
  assert.equal(
    check("apply_patch", {
      command:
        "*** Begin Patch\n*** Update File: README.md\n+hi\n*** End Patch",
    }),
    null,
  );
  assert.equal(
    check("apply_patch", {
      command:
        "*** Begin Patch\n*** Update File: CONTRIBUTING.md\n+packages/db/migrations\n*** End Patch",
    }),
    null,
  );
});

for (const command of [
  "cat packages/db/migrations/0001.sql",
  "head -n 30 packages/db/migrations/0001.sql",
  "tail -n 10 packages/db/migrations/0001.sql",
  "grep -n CREATE packages/db/migrations/0001.sql",
  "ls packages/db/migrations",
  "wc -l packages/db/migrations/0001.sql",
  "stat packages/db/migrations/0001.sql",
  "cmp packages/db/migrations/0001.sql packages/db/migrations/0001.sql",
  "diff packages/db/migrations/0001.sql packages/db/migrations/0001.sql",
  ...[
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
  ].map((name) => `${name} packages/db/migrations/0001.sql`),
  "pwd",
]) {
  test(`read-only command: ${command}`, () => {
    const cwd = command === "pwd" ? migrationDirectory : root;
    assert.equal(check("Bash", { command }, cwd), null);
  });
}

test("relative paths use the session cwd", () => {
  assert.equal(
    check(
      "Bash",
      { command: "cat migrations/0001.sql" },
      path.join(root, "packages/db"),
    ),
    null,
  );
  assert.equal(
    check("Bash", { command: "rm 0001.sql" }, migrationDirectory) !== null,
    true,
  );
});

for (const command of [
  "git add -- packages/db/migrations/0001.sql",
  "git restore --staged -- packages/db/migrations/0001.sql",
  "git add -- packages/db/migrations/0001.sql packages/db/migrations/0002.sql",
]) {
  test(`allows explicit migration Git operation: ${command}`, () =>
    assert.equal(check("Bash", { command }), null));
}

test("explicit Git files must resolve from cwd inside migrations", () => {
  const cwd = path.join(root, "nested");
  const outsideMigration = path.join(cwd, "packages/db/migrations/0001.sql");
  mkdirSync(path.dirname(outsideMigration), { recursive: true });
  writeFileSync(outsideMigration, "outside migration directory\n");
  assert.ok(
    check(
      "Bash",
      { command: "git add -- packages/db/migrations/0001.sql" },
      cwd,
    ),
  );
});

test("symlink files inside migrations are not allowed Git targets", (context) => {
  const symlink = path.join(migrationDirectory, "alias.sql");
  try {
    symlinkSync(migrationFile, symlink);
  } catch (error) {
    if (["EPERM", "ENOTSUP", "EOPNOTSUPP"].includes(error.code)) {
      context.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.equal(lstatSync(symlink).isSymbolicLink(), true);
  assert.ok(
    check("Bash", { command: "git add -- packages/db/migrations/alias.sql" }),
  );
});

for (const command of [
  "git add packages/db/migrations/0001.sql",
  "git add -- packages/db/migrations",
  "git add -- packages/db/migrations/",
  "git add -- .",
  "git add -A",
  "git add -u",
  "git add -- packages/db/migrations/*.sql",
  "git add -- :(glob)packages/db/migrations/*.sql",
  "git add -- packages/db/migrations/0001.sql README.md",
  "git restore --staged packages/db/migrations/0001.sql",
  "git restore --staged -- packages/db/migrations",
  "git restore --staged -- packages/db/migrations/0001.sql README.md",
  "git add -- packages/db/migrations/0001.sql && true",
  "git status -- packages/db/migrations/0001.sql",
]) {
  test(`denies unsafe migration Git operation: ${command}`, () =>
    assert.ok(check("Bash", { command })));
}

test("migration denial messages give the safe next action", () => {
  const direct = check("apply_patch", {
    command:
      "*** Begin Patch\n*** Update File: packages/db/migrations/0001.sql\n*** End Patch",
  });
  assert.match(
    direct,
    /Refused direct migration file.*schema.*canonical.*generate/,
  );

  const unsafeGit = check("Bash", {
    command: "git add -A",
  });
  assert.match(
    unsafeGit,
    /Refused broad Git.*git add -- <explicit migration file>/,
  );

  const unknown = check("Bash", {
    command: "git add packages/db/migrations/0001.sql",
  });
  assert.match(unknown, /git add -- <explicit migration file>/);
});

for (const command of [
  "pnpm --filter @repo/db generate",
  "pnpm --filter @repo/db generate --",
  "pnpm --filter @repo/db generate -- add-user-status",
  "pnpm --filter @repo/db generate -- BAD",
  "pnpm --filter @repo/db generate -- foo bar",
]) {
  test(`canonical generator: ${command}`, () =>
    assert.equal(check("Bash", { command }), null));
}

for (const directive of ["Add File", "Update File", "Delete File"]) {
  test(`denies migration patch: ${directive}`, () => {
    assert.match(
      check("apply_patch", {
        command: `*** Begin Patch\n*** ${directive}: packages/db/migrations/0001.sql\n*** End Patch`,
      }),
      /Refused direct migration file.*schema.*canonical.*generate/,
    );
  });
}

for (const target of [
  "packages/db/../db/migrations/0001.sql",
  "./packages/db/migrations/0001.sql",
  migrationFile,
]) {
  test(`normalizes patch target: ${target}`, () => {
    assert.ok(
      check("apply_patch", {
        command: `*** Begin Patch\n*** Update File: ${target}\n*** End Patch`,
      }),
    );
  });
}

test("denies migration move destination", () => {
  assert.ok(
    check("apply_patch", {
      command:
        "*** Begin Patch\n*** Update File: README.md\n*** Move to: packages/db/migrations/0002.sql\n*** End Patch",
    }),
  );
});

for (const executable of [
  "rm",
  "cp",
  "mv",
  "touch",
  "tee",
  "truncate",
  "install",
  "ln",
  "chmod",
  "chown",
  "dd",
  "sed",
  "awk",
  "sort",
  "uniq",
  "file",
  "less",
  "more",
  "find",
  "rg",
  "node",
  "python",
  "python3",
  "perl",
  "ruby",
  "sh",
  "bash",
  "zsh",
  "xargs",
]) {
  test(`denies migration access through ${executable}`, () => {
    assert.ok(
      check("Bash", {
        command: `${executable} packages/db/migrations/0001.sql`,
      }),
    );
  });
}

for (const command of [
  "cat packages/db/migrations/0001.sql > out",
  "cat packages/db/migrations/0001.sql >> out",
  "cat packages/db/migrations/0001.sql < other",
  "cat packages/db/migrations/0001.sql | tee out",
  "cat packages/db/migrations/0001.sql || true",
  "cat packages/db/migrations/0001.sql && true",
  "cat packages/db/migrations/0001.sql; true",
  "cat packages/db/migrations/0001.sql &",
  "cat $(pwd)/packages/db/migrations/0001.sql",
  "cat `pwd`/packages/db/migrations/0001.sql",
  "cat $VAR/packages/db/migrations/0001.sql",
  `cat ${"$"}{VAR}/packages/db/migrations/0001.sql`,
  "cat packages/db/migrations/*.sql",
  "cat packages/db/migrations/000?.sql",
  "cat packages/db/migrations/{0001,0002}.sql",
  "cat 'packages/db/migrations/0001.sql'",
  'cat "packages/db/migrations/0001.sql"',
  "cat packages/db/migrations/0001\\.sql",
  `cat packages/db/${"migrations".replace("t", '"t')}/0001.sql`,
  `cat packages/db/${"migrations".replace("t", "\\t")}/0001.sql`,
  "cat packages/db/migrations/0001.sql\nrm out",
  "cat packages/db/migrations/0001.sql\rrm out",
  "FOO=bar cat packages/db/migrations/0001.sql",
  "cd packages/db && rm migrations/0001.sql",
  "cd packages && cd db && rm migrations/0001.sql",
]) {
  test(`denies shell construction: ${JSON.stringify(command)}`, () =>
    assert.ok(check("Bash", { command })));
}

for (const command of [
  "drizzle-kit generate --name=test",
  "pnpm exec drizzle-kit generate --name=test",
  "pnpm --filter @repo/db exec drizzle-kit generate --name=test",
  "npx drizzle-kit generate --name=test",
  "node packages/db/scripts/generate-migration.mjs test",
  "pnpm --filter @repo/db run generate -- test",
  "pnpm --filter @repo/db generate -- foo && true",
  "pnpm --filter @repo/db generate -- foo\n",
  "pnpm --filter @repo/db generate -- foo > out",
  "FOO=bar pnpm --filter @repo/db generate -- foo",
  'pnpm --filter @repo/db generate -- "$(true)"',
]) {
  test(`denies generator bypass: ${command}`, () =>
    assert.ok(check("Bash", { command })));
}

test("normalizes Bash paths", () => {
  for (const target of [
    "./packages/db/migrations/0001.sql",
    "packages/db/../db/migrations/0001.sql",
  ]) {
    assert.ok(check("Bash", { command: `touch ${target}` }));
  }
});

test("existing symlink to migration directory is protected", (context) => {
  try {
    symlinkSync(migrationDirectory, path.join(root, "migration-alias"));
  } catch (error) {
    if (["EPERM", "ENOTSUP", "EOPNOTSUPP"].includes(error.code)) {
      context.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.ok(check("Bash", { command: "touch migration-alias/new.sql" }));
  assert.equal(
    check("Bash", { command: "cat migration-alias/0001.sql" }),
    null,
  );
});

test("unknown tools fail closed for file targets, but orchestration text does not block", () => {
  assert.ok(check("mcp__filesystem__write_file", { path: migrationFile }));
  assert.ok(
    check("mcp__filesystem__move_file", { destination: migrationFile }),
  );
  assert.ok(check("exec_command", { cmd: `rm ${migrationFile}` }));
  assert.ok(
    check("exec_command", {
      cmd: "pnpm exec drizzle-kit generate --name=test",
    }),
  );
  assert.equal(
    check("exec_command", {
      cmd: "pnpm --filter @repo/db generate -- BAD",
    }),
    null,
  );
  assert.ok(
    check("functions.apply_patch", {
      patch: `*** Begin Patch\n*** Add File: ${migrationFile}\n*** End Patch`,
    }),
  );
  const unknown = check("mcp__filesystem__write_file", { path: migrationFile });
  assert.match(unknown, /packages\/db\/migrations/);
  assert.match(unknown, /cannot be verified as read-only/);
  assert.match(unknown, /stop and report/);
  assert.equal(
    check("spawn_agent", { prompt: `Describe ${migrationFile}` }),
    null,
  );
});

test("malformed input and protocol fail closed", () => {
  assert.ok(check("Bash", { command: 123 }));
  assert.ok(check("apply_patch", { command: 123 }));
  const invalid = spawnSync(process.execPath, [hook], {
    input: "{",
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(invalid.status, 0);
  assert.equal(
    JSON.parse(invalid.stdout).hookSpecificOutput.permissionDecision,
    "deny",
  );
  const invalidReason = JSON.parse(invalid.stdout).hookSpecificOutput
    .permissionDecisionReason;
  assert.match(invalidReason, /packages\/db\/migrations/);
  assert.match(invalidReason, /could not evaluate/);
  assert.match(invalidReason, /Stop and report/);
  const blocked = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: `rm ${migrationFile}` },
    }),
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(
    JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision,
    "deny",
  );
  const allowed = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: `cat ${migrationFile}` },
    }),
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, "");
});

test("default repository root protects real migration paths", () => {
  const relativeFile = "packages/db/migrations/0000_init.sql";
  const absoluteFile = path.join(repositoryRoot, relativeFile);
  const evaluate = (command, cwd = repositoryRoot) =>
    evaluateMigrationAccess(
      { tool_name: "Bash", tool_input: { command } },
      { cwd },
    );

  assert.equal(evaluate(`cat ${relativeFile}`), null);
  assert.ok(evaluate(`rm ${relativeFile}`));
  assert.ok(evaluate("rm 0000_init.sql", path.dirname(absoluteFile)));
  assert.ok(evaluate(`rm ${absoluteFile}`));
});

test("executable hook accepts unrelated apply_patch and denies migration patch", () => {
  const invoke = (command) =>
    spawnSync(process.execPath, [hook], {
      input: JSON.stringify({
        tool_name: "apply_patch",
        tool_input: { command },
      }),
      encoding: "utf8",
      cwd: repositoryRoot,
    });
  const unrelated = invoke(
    "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch",
  );
  assert.equal(unrelated.status, 0);
  assert.equal(unrelated.stdout, "");

  const migration = invoke(
    "*** Begin Patch\n*** Update File: packages/db/migrations/0000_init.sql\n@@\n-old\n+new\n*** End Patch",
  );
  assert.equal(migration.status, 0);
  assert.equal(
    JSON.parse(migration.stdout).hookSpecificOutput.permissionDecision,
    "deny",
  );
});

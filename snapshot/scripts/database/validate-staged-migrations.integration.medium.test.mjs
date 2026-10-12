import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function command(cwd, name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function git(cwd, ...args) {
  const result = command(cwd, "git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function untrackedFileSnapshot(cwd) {
  const files = git(cwd, "ls-files", "--others", "--exclude-standard")
    .split("\n")
    .filter(Boolean);
  return files.map((file) => {
    const fullPath = path.join(cwd, file);
    const metadata = lstatSync(fullPath);
    return [
      file,
      metadata.isSymbolicLink()
        ? { type: "symlink", target: readlinkSync(fullPath) }
        : { type: "file", contents: readFileSync(fullPath).toString("base64") },
    ];
  });
}

function linkFixtureDependencyStore(fixture) {
  const sourceStore = path.join(ROOT, "node_modules/.pnpm");
  const fixtureStore = path.join(fixture, "node_modules/.pnpm");
  mkdirSync(fixtureStore, { recursive: true });
  for (const entry of readdirSync(sourceStore)) {
    if (entry === "node_modules") continue;
    symlinkSync(
      path.join(sourceStore, entry),
      path.join(fixtureStore, entry),
      "dir",
    );
  }
  cpSync(
    path.join(sourceStore, "node_modules"),
    path.join(fixtureStore, "node_modules"),
    { recursive: true, dereference: false },
  );
  const workspaceScope = path.join(fixture, "node_modules/@repo");
  mkdirSync(workspaceScope, { recursive: true });
  for (const workspaceDirectory of ["modules", "packages"]) {
    for (const entry of readdirSync(path.join(fixture, workspaceDirectory))) {
      const packageDirectory = path.join(fixture, workspaceDirectory, entry);
      const packageManifest = path.join(packageDirectory, "package.json");
      if (!existsSync(packageManifest)) continue;
      const packageName = JSON.parse(
        readFileSync(packageManifest, "utf8"),
      ).name;
      if (!packageName?.startsWith("@repo/")) continue;
      symlinkSync(
        packageDirectory,
        path.join(workspaceScope, packageName.slice("@repo/".length)),
        "dir",
      );
    }
  }
}

describe("staged migration validation integration", () => {
  it("validates staged state with the canonical generator and preserves repository state", () => {
    const fixture = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "timecard-staged-migration-test-")),
    );
    try {
      const archive = execFileSync("git", ["archive", "HEAD"], {
        cwd: ROOT,
        maxBuffer: 100 * 1024 * 1024,
      });
      execFileSync("tar", ["-x", "-C", fixture], { input: archive });
      writeFileSync(
        path.join(fixture, ".env.local"),
        "DATABASE_URL=postgresql://test:test@localhost:5432/timecard_test\nDATABASE_ENVIRONMENT=local\n",
      );
      mkdirSync(path.join(fixture, "scripts/database"), { recursive: true });
      cpSync(
        path.join(ROOT, "scripts/database/validate-staged-migrations.mjs"),
        path.join(fixture, "scripts/database/validate-staged-migrations.mjs"),
      );
      cpSync(
        path.join(ROOT, "scripts/database/drizzle-interaction.py"),
        path.join(fixture, "scripts/database/drizzle-interaction.py"),
      );
      cpSync(
        path.join(ROOT, "packages/db/node_modules"),
        path.join(fixture, "packages/db/node_modules"),
        { recursive: true, dereference: false },
      );
      linkFixtureDependencyStore(fixture);
      git(fixture, "init", "-q");
      git(fixture, "config", "user.email", "migration-test@example.invalid");
      git(fixture, "config", "user.name", "Migration integration test");
      git(fixture, "add", "-A");
      git(fixture, "commit", "-qm", "fixture base");
      const fixtureUsersLink = path.join(
        fixture,
        "packages/db/node_modules/@repo/users",
      );
      rmSync(fixtureUsersLink, { recursive: true, force: true });
      symlinkSync(path.join(fixture, "modules/users"), fixtureUsersLink);

      const schemaPath = "packages/db/src/schema.ts";
      const journalPath = "packages/db/migrations/meta/_journal.json";
      const compositionPath = "packages/db/src/schema.ts";
      const moduleSchemaPath = "modules/users/src/schema/users.ts";
      const attendanceSchemaIndexPath =
        "modules/attendance/src/schema/index.ts";

      const validator = (extraEnv = {}) => {
        const indexBefore = git(fixture, "diff", "--cached", "--binary");
        const worktreeBefore = git(fixture, "diff", "--binary");
        const statusBefore = git(
          fixture,
          "status",
          "--short",
          "--untracked-files=all",
        );
        const untrackedBefore = untrackedFileSnapshot(fixture);
        const result = command(
          fixture,
          process.execPath,
          ["scripts/database/validate-staged-migrations.mjs"],
          { env: { ...process.env, ...extraEnv } },
        );
        assert.equal(git(fixture, "diff", "--cached", "--binary"), indexBefore);
        assert.equal(git(fixture, "diff", "--binary"), worktreeBefore);
        assert.equal(
          git(fixture, "status", "--short", "--untracked-files=all"),
          statusBefore,
        );
        assert.deepEqual(untrackedFileSnapshot(fixture), untrackedBefore);
        return result;
      };

      // A composition-only staged change has no database effect and needs no
      // migration, even though it is a schema-related path.
      writeFileSync(
        path.join(fixture, compositionPath),
        `${readFileSync(path.join(fixture, compositionPath), "utf8")}// composition-only refactor\n`,
      );
      git(fixture, "add", compositionPath);
      const compositionOnly = validator();
      assert.equal(compositionOnly.status, 0, compositionOnly.stderr);
      git(
        fixture,
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        compositionPath,
      );

      // The staged module schema is imported indirectly by Attendance. A
      // worktree-only schema change must not affect the neutral staged result.
      const originalModuleSchema = readFileSync(
        path.join(fixture, moduleSchemaPath),
        "utf8",
      );
      const changedModuleSchema = originalModuleSchema.replace(
        'displayName: text("display_name"),',
        'displayName: text("display_name"),\n    migrationProbe: text("migration_probe"),',
      );
      const originalComposition = readFileSync(
        path.join(fixture, compositionPath),
        "utf8",
      );
      const originalAttendanceSchemaIndex = readFileSync(
        path.join(fixture, attendanceSchemaIndexPath),
        "utf8",
      );
      const indirectComposition = originalComposition
        .split("\n")
        .filter((line) => !line.includes('export * from "@repo/users/schema";'))
        .join("\n");
      writeFileSync(
        path.join(fixture, attendanceSchemaIndexPath),
        `${originalAttendanceSchemaIndex}export * from "@repo/users/schema";\n`,
      );
      writeFileSync(
        path.join(fixture, moduleSchemaPath),
        `${originalModuleSchema}// staged composition-only module edit\n`,
      );
      writeFileSync(path.join(fixture, compositionPath), indirectComposition);
      git(
        fixture,
        "add",
        moduleSchemaPath,
        compositionPath,
        attendanceSchemaIndexPath,
      );
      writeFileSync(path.join(fixture, moduleSchemaPath), changedModuleSchema);
      const fixtureDirectUsersLink = path.join(
        fixture,
        "packages/db/node_modules/@repo/users",
      );
      rmSync(fixtureDirectUsersLink, { recursive: true, force: true });
      const stagedNeutralWorktreeChanged = validator();
      symlinkSync(path.join(fixture, "modules/users"), fixtureDirectUsersLink);
      assert.equal(
        stagedNeutralWorktreeChanged.status,
        0,
        stagedNeutralWorktreeChanged.stderr,
      );

      // Conversely, a real staged DB schema change must fail even after the
      // worktree is reverted to its original schema.
      git(
        fixture,
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        moduleSchemaPath,
        compositionPath,
        attendanceSchemaIndexPath,
      );
      writeFileSync(path.join(fixture, moduleSchemaPath), changedModuleSchema);
      git(fixture, "add", moduleSchemaPath);
      writeFileSync(path.join(fixture, moduleSchemaPath), originalModuleSchema);
      const missingMigration = validator();
      assert.notEqual(
        missingMigration.status,
        0,
        `${missingMigration.stdout}${missingMigration.stderr}`,
      );
      assert.match(missingMigration.stderr, /requires a staged migration/);

      // Generate from the staged module schema, then revert only the worktree
      // copy. Artifact validation must continue to use the staged bytes.
      writeFileSync(path.join(fixture, moduleSchemaPath), changedModuleSchema);
      const binPath = path.join(fixture, "packages/db/node_modules/.bin");
      const generatedModuleMigration = command(
        fixture,
        process.execPath,
        ["scripts/generate-migration.mjs", "module_probe"],
        {
          cwd: path.join(fixture, "packages/db"),
          env: {
            ...process.env,
            NODE_OPTIONS: [
              Reflect.get(process.env, "NODE_OPTIONS"),
              "--conditions=development",
            ]
              .filter(Boolean)
              .join(" "),
            PATH: `${binPath}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      assert.equal(
        generatedModuleMigration.status,
        0,
        generatedModuleMigration.stderr,
      );
      git(fixture, "add", "-f", "packages/db/migrations");
      writeFileSync(path.join(fixture, moduleSchemaPath), originalModuleSchema);
      const validModuleMigration = validator();
      assert.equal(validModuleMigration.status, 0, validModuleMigration.stderr);
      git(
        fixture,
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        moduleSchemaPath,
        "packages/db/migrations",
      );

      // A real Drizzle rename prompt is enumerated and each option is tested
      // from a clean generation checkout; the matching rename candidate passes.
      const renamedUsers = originalModuleSchema.replace(
        'displayName: text("display_name"),',
        'displayName: text("full_name"),',
      );
      writeFileSync(path.join(fixture, moduleSchemaPath), renamedUsers);
      const helper = path.join(
        fixture,
        "scripts/database/drizzle-interaction.py",
      );
      const generator = path.join(
        fixture,
        "packages/db/scripts/generate-migration.mjs",
      );
      const driverEnvironment = {
        ...process.env,
        NODE_OPTIONS: [
          Reflect.get(process.env, "NODE_OPTIONS"),
          "--conditions=development",
        ]
          .filter(Boolean)
          .join(" "),
        PATH: `${path.join(fixture, "packages/db/node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      };
      const probe = command(
        fixture,
        "python3",
        [
          helper,
          "probe",
          "0",
          process.execPath,
          generator,
          "rename_user_column",
        ],
        { cwd: path.join(fixture, "packages/db"), env: driverEnvironment },
      );
      assert.equal(probe.status, 0, probe.stderr);
      const menu = JSON.parse(probe.stdout);
      assert.equal(menu.promptSeen, true, menu.transcript);
      assert.ok(menu.options.some((option) => /rename column/i.test(option)));
      const renameIndex = menu.options.findIndex((option) =>
        /rename column/i.test(option),
      );
      const renameGeneration = command(
        fixture,
        "python3",
        [
          helper,
          "select",
          String(renameIndex),
          process.execPath,
          generator,
          "rename_user_column",
        ],
        { cwd: path.join(fixture, "packages/db"), env: driverEnvironment },
      );
      assert.equal(renameGeneration.status, 0, renameGeneration.stderr);
      const renameResult = JSON.parse(renameGeneration.stdout);
      assert.equal(renameResult.exitCode, 0, renameResult.transcript);
      assert.equal(renameResult.secondPrompt, false);
      git(fixture, "add", "-f", moduleSchemaPath, "packages/db/migrations");
      const validRename = validator();
      assert.equal(validRename.status, 0, validRename.stderr);

      const journalArtifact = "packages/db/migrations/meta/_journal.json";
      const journal = JSON.parse(
        readFileSync(path.join(fixture, journalArtifact), "utf8"),
      );
      const entry = journal.entries.at(-1);
      const sqlArtifact = `packages/db/migrations/${entry.tag}.sql`;
      const snapshotArtifact = `packages/db/migrations/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`;
      const canonicalArtifacts = new Map(
        [journalArtifact, sqlArtifact, snapshotArtifact].map((file) => [
          file,
          readFileSync(path.join(fixture, file), "utf8"),
        ]),
      );
      const rejectInvalidCandidate = (file, contents, expectedError) => {
        writeFileSync(path.join(fixture, file), contents);
        git(fixture, "add", "-f", file);
        const result = validator();
        assert.notEqual(result.status, 0, `${file} unexpectedly matched`);
        assert.match(result.stderr, expectedError);
        writeFileSync(path.join(fixture, file), canonicalArtifacts.get(file));
        git(fixture, "add", "-f", file);
      };

      rejectInvalidCandidate(
        sqlArtifact,
        `${canonicalArtifacts.get(sqlArtifact)}\n-- non canonical staged SQL\n`,
        /Staged migration SQL differs from Drizzle's generated SQL/,
      );
      const changedSnapshot = JSON.parse(
        canonicalArtifacts.get(snapshotArtifact),
      );
      changedSnapshot.tables["public.users"].columns.full_name.type = "varchar";
      rejectInvalidCandidate(
        snapshotArtifact,
        `${JSON.stringify(changedSnapshot, null, 2)}\n`,
        /Staged migration snapshot does not match the canonical generated result/,
      );
      const changedJournal = JSON.parse(
        canonicalArtifacts.get(journalArtifact),
      );
      changedJournal.entries.at(-1).unexpected = true;
      rejectInvalidCandidate(
        journalArtifact,
        `${JSON.stringify(changedJournal, null, 2)}\n`,
        /Staged migration journal entry does not match the canonical generated result/,
      );

      // Add a second real rename to the staged schema while retaining the
      // canonical first-rename artifacts, so validation reaches the second menu.
      const twoRenamedUsers = renamedUsers.replace(
        'lineUserId: text("line_user_id").notNull().unique(),',
        'lineUserId: text("line_id").notNull().unique(),',
      );
      writeFileSync(path.join(fixture, moduleSchemaPath), twoRenamedUsers);
      git(fixture, "add", moduleSchemaPath);
      const multipleDecisions = validator();
      assert.notEqual(multipleDecisions.status, 0);
      assert.match(multipleDecisions.stderr, /second interactive decision/i);
      assert.match(
        multipleDecisions.stderr,
        /split schema changes into separate migrations\/commits/i,
      );
      git(
        fixture,
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        moduleSchemaPath,
        "packages/db/migrations",
      );

      writeFileSync(
        path.join(fixture, schemaPath),
        `${readFileSync(path.join(fixture, schemaPath), "utf8")}\n` +
          'import { pgTable, text } from "drizzle-orm/pg-core";\n' +
          'export const migrationProbe = pgTable("migration_probe", { id: text("id") });\n',
      );
      const generated = command(
        fixture,
        process.execPath,
        ["scripts/generate-migration.mjs", "probe"],
        {
          cwd: path.join(fixture, "packages/db"),
          env: {
            ...process.env,
            NODE_OPTIONS: [
              Reflect.get(process.env, "NODE_OPTIONS"),
              "--conditions=development",
            ]
              .filter(Boolean)
              .join(" "),
            PATH: `${binPath}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      assert.equal(generated.status, 0, generated.stderr);
      git(fixture, "add", "-f", schemaPath, "packages/db/migrations");

      // One full-path run covers real generation, staged-only schema semantics,
      // coexistence with an unrelated staged file, and non-destruction.
      writeFileSync(
        path.join(fixture, "README.md"),
        "Unrelated staged change.\n",
      );
      git(fixture, "add", "README.md");
      writeFileSync(
        path.join(fixture, schemaPath),
        `${readFileSync(path.join(fixture, schemaPath), "utf8")}// unstaged change\n`,
      );
      const valid = validator();
      assert.equal(valid.status, 0, valid.stderr);

      // With only an unrelated staged file, validation returns before preparing
      // the Drizzle working copy or invoking its generator.
      git(
        fixture,
        "restore",
        "--staged",
        "--",
        schemaPath,
        "packages/db/migrations",
      );
      const drizzleKit = path.join(
        fixture,
        "packages/db/node_modules/drizzle-kit",
      );
      rmSync(drizzleKit, { recursive: true, force: true });
      mkdirSync(drizzleKit, { recursive: true });
      writeFileSync(
        path.join(drizzleKit, "bin.cjs"),
        'throw new Error("Unexpected Drizzle invocation during unrelated-only validation");\n',
      );
      const noOp = validator();
      assert.equal(noOp.status, 0, noOp.stderr);

      // A staged journal deletion follows the real Git index/filesystem path and
      // retains the user-facing missing-journal error.
      rmSync(path.join(fixture, journalPath));
      git(fixture, "add", "-u", journalPath);
      const missingJournal = validator();
      assert.notEqual(missingJournal.status, 0);
      assert.match(missingJournal.stderr, /journal is missing/i);

      git(
        fixture,
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        journalPath,
      );
      const oldMigration = "packages/db/migrations/0000_initial_schema.sql";
      const canonicalOldMigration = readFileSync(
        path.join(fixture, oldMigration),
        "utf8",
      );
      writeFileSync(
        path.join(fixture, oldMigration),
        `${canonicalOldMigration}\n-- changed`,
      );
      git(fixture, "add", oldMigration);
      const changedHistory = validator();
      assert.notEqual(changedHistory.status, 0);
      assert.match(changedHistory.stderr, /Existing migration history/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

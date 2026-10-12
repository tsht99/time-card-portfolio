import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DB = "packages/db";
const MIGRATIONS = `${DB}/migrations`;
const JOURNAL = `${MIGRATIONS}/meta/_journal.json`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

function git(...args) {
  return run("git", args).trimEnd();
}

function parseJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Invalid or missing JSON file ${file}: ${error.message}`);
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}

function compareJson(actual, expected, label) {
  if (JSON.stringify(stable(actual)) !== JSON.stringify(stable(expected))) {
    throw new Error(`${label} does not match the canonical generated result.`);
  }
}

function compareSql(actual, expected) {
  if (actual !== expected) {
    throw new Error(
      "Staged migration SQL differs from Drizzle's generated SQL.",
    );
  }
}

function assertExistingHistoryUnchanged(changes) {
  const changedExisting = changes.filter(
    ({ status, file }) => status !== "A" && file !== JOURNAL,
  );
  if (changedExisting.length) {
    throw new Error(
      `Existing migration history cannot be changed or deleted:\n${changedExisting
        .map(({ status, file }) => `${status}\t${file}`)
        .join("\n")}`,
    );
  }
}

function normalizeSnapshot(snapshot) {
  // Drizzle creates a fresh UUID for every snapshot generation; prevId and all
  // schema content remain deterministic and are compared without normalization.
  return { ...snapshot, id: "<generated-snapshot-id>" };
}

function migrationNameFromTag(tag) {
  return tag.replace(/^\d+_/, "");
}

function validateCandidateData({
  stagedJournal,
  headJournal,
  addedFiles,
  presentFiles,
}) {
  if (
    stagedJournal.version !== headJournal.version ||
    stagedJournal.dialect !== headJournal.dialect ||
    stagedJournal.entries.length !== headJournal.entries.length + 1
  ) {
    throw new Error("Staged migration journal must append exactly one entry.");
  }
  compareJson(
    stagedJournal.entries.slice(0, -1),
    headJournal.entries,
    "Existing migration journal entries",
  );

  const entry = stagedJournal.entries.at(-1);
  const expectedIdx = headJournal.entries.length;
  const tagMatch = /^\d{4,}_[a-z0-9][a-z0-9_-]*$/.exec(entry?.tag ?? "");
  if (
    !tagMatch ||
    entry.idx !== expectedIdx ||
    entry.version !== stagedJournal.version ||
    typeof entry.when !== "number" ||
    entry.breakpoints !== true
  ) {
    throw new Error("The appended migration journal entry is malformed.");
  }

  const sql = `${MIGRATIONS}/${entry.tag}.sql`;
  const snapshot = `${MIGRATIONS}/meta/${String(expectedIdx).padStart(4, "0")}_snapshot.json`;
  const stagedFiles = [...addedFiles].sort();
  const expectedFiles = [sql, snapshot].sort();
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Staged migration must add exactly its SQL and snapshot files. Expected ${expectedFiles.join(", ")}; got ${stagedFiles.join(", ")}.`,
    );
  }
  if (!presentFiles.has(sql) || !presentFiles.has(snapshot)) {
    throw new Error("The migration SQL or snapshot is missing from the index.");
  }

  return { entry, sql, snapshot };
}

function compareGeneratedJournalEntry(actual, expected) {
  const expectedWithGeneratedWhen = { ...expected, when: actual?.when };
  compareJson(
    actual,
    expectedWithGeneratedWhen,
    "Staged migration journal entry",
  );
}

function stagedDatabasePaths() {
  return git("diff", "--cached", "--name-only", "HEAD")
    .split("\n")
    .filter(Boolean);
}

function isSchemaValidationPath(file) {
  return (
    file === `${DB}/src/schema.ts` ||
    /^modules\/[^/]+\/src\/schema\//.test(file) ||
    file.startsWith(`${MIGRATIONS}/`) ||
    file === `${DB}/drizzle.config.ts` ||
    file === `${DB}/scripts/generate-migration.mjs`
  );
}

function stagedMigrationAdditions() {
  return git(
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=A",
    "HEAD",
    "--",
    MIGRATIONS,
  )
    .split("\n")
    .filter(Boolean);
}

function workspacePackages(root) {
  const packages = new Map();
  for (const workspaceDirectory of ["modules", "packages"]) {
    for (const name of readdirSync(path.join(root, workspaceDirectory))) {
      const packageDirectory = path.join(root, workspaceDirectory, name);
      const manifest = path.join(packageDirectory, "package.json");
      if (!existsSync(manifest)) continue;
      const packageName = JSON.parse(readFileSync(manifest, "utf8")).name;
      if (packageName) packages.set(packageName, packageDirectory);
    }
  }
  return packages;
}

function redirectWorkspaceLinks(nodeModulesPath, workspacePackagePaths) {
  const scopePath = path.join(nodeModulesPath, "@repo");
  if (!existsSync(scopePath)) return;
  for (const name of readdirSync(scopePath)) {
    const packageName = `@repo/${name}`;
    const stagedPackagePath = workspacePackagePaths.get(packageName);
    if (!stagedPackagePath) continue;
    const link = path.join(scopePath, name);
    rmSync(link, { recursive: true, force: true });
    symlinkSync(stagedPackagePath, link);
  }
}

function checkExistingHistory() {
  const changes = git(
    "diff",
    "--cached",
    "--name-status",
    "HEAD",
    "--",
    MIGRATIONS,
  )
    .split("\n")
    .filter(Boolean);
  assertExistingHistoryUnchanged(
    changes.map((line) => {
      const [status, file] = line.split("\t");
      return { status, file };
    }),
  );
}

function validateCandidate(stagedRoot) {
  const journalPath = path.join(stagedRoot, JOURNAL);
  const stagedJournal = parseJson(journalPath);
  const headJournalText = git("show", `HEAD:${JOURNAL}`);
  const headJournal = JSON.parse(headJournalText);
  const entry = stagedJournal.entries.at(-1);
  const stagedFiles = git(
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=A",
    "HEAD",
    "--",
    MIGRATIONS,
  )
    .split("\n")
    .filter(Boolean);
  const presentFiles = new Set(
    [
      `${MIGRATIONS}/${entry?.tag}.sql`,
      `${MIGRATIONS}/meta/${String(headJournal.entries.length).padStart(4, "0")}_snapshot.json`,
    ].filter((file) => existsSync(path.join(stagedRoot, file))),
  );
  const candidateData = validateCandidateData({
    stagedJournal,
    headJournal,
    addedFiles: stagedFiles,
    presentFiles,
  });

  return { ...candidateData, journalPath };
}

function compareGenerated(stagedRoot, generatedRoot, candidate) {
  const dbDir = path.join(generatedRoot, DB);
  const expectedSql = readFileSync(
    path.join(stagedRoot, candidate.sql),
    "utf8",
  );
  const expectedSnapshot = parseJson(path.join(stagedRoot, candidate.snapshot));
  const expectedJournalEntry = candidate.entry;
  const journalPath = path.join(generatedRoot, JOURNAL);
  const generatedSql = path.join(
    dbDir,
    "migrations",
    `${candidate.entry.tag}.sql`,
  );
  const generatedSnapshot = path.join(
    dbDir,
    "migrations/meta",
    `${String(candidate.entry.idx).padStart(4, "0")}_snapshot.json`,
  );
  if (!existsSync(generatedSql) || !existsSync(generatedSnapshot)) {
    throw new Error(
      "Drizzle did not regenerate the staged migration artifacts.",
    );
  }
  compareSql(readFileSync(generatedSql, "utf8"), expectedSql);
  compareJson(
    normalizeSnapshot(parseJson(generatedSnapshot)),
    normalizeSnapshot(expectedSnapshot),
    "Staged migration snapshot",
  );
  const actualEntry = parseJson(journalPath).entries.at(-1);
  compareGeneratedJournalEntry(actualEntry, expectedJournalEntry);
}

function migrationGeneratorEnvironment(dbDir) {
  return {
    ...process.env,
    NODE_OPTIONS: [
      Reflect.get(process.env, "NODE_OPTIONS"),
      "--conditions=development",
    ]
      .filter(Boolean)
      .join(" "),
    PATH: `${path.join(dbDir, "node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function runInteractiveGenerator(root, migrationName, mode, optionIndex = 0) {
  const dbDir = path.join(root, DB);
  const driver = path.join(ROOT, "scripts/database/drizzle-interaction.py");
  const result = spawnSync(
    "python3",
    [
      driver,
      mode,
      String(optionIndex),
      process.execPath,
      path.join(dbDir, "scripts/generate-migration.mjs"),
      migrationName,
    ],
    {
      cwd: dbDir,
      encoding: "utf8",
      env: migrationGeneratorEnvironment(dbDir),
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Drizzle interaction driver failed: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Drizzle interaction driver returned invalid output: ${error.message}`,
    );
  }
}

function prepareCandidateGeneration(stagedRoot, candidate) {
  const generatedRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "timecard-drizzle-candidate-")),
  );
  try {
    cpSync(stagedRoot, generatedRoot, { recursive: true, dereference: false });
    const journalPath = path.join(generatedRoot, JOURNAL);
    const journal = parseJson(journalPath);
    journal.entries.pop();
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    rmSync(path.join(generatedRoot, candidate.sql));
    rmSync(path.join(generatedRoot, candidate.snapshot));
    return generatedRoot;
  } catch (error) {
    rmSync(generatedRoot, { recursive: true, force: true });
    throw error;
  }
}

function assertNoSecondDecision(result) {
  if (result.secondPrompt) {
    throw new Error(
      "Drizzle requested a second interactive decision. At most one decision is supported per migration/commit; split schema changes into separate migrations/commits.",
    );
  }
}

function prepareStagedCheckout() {
  const tempRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "timecard-staged-db-")),
  );
  try {
    run("git", ["checkout-index", "--all", `--prefix=${tempRoot}/`]);
    const stagedRoot = tempRoot;
    // Drizzle config validates the canonical Local settings source. Migration
    // artifact checks are filesystem-only, so provide a deterministic fake
    // connection string in the isolated checkout rather than reading a
    // developer's local environment.
    writeFileSync(
      path.join(stagedRoot, ".env.local"),
      "DATABASE_URL=postgresql://test:test@localhost:5432/timecard_test\nDATABASE_ENVIRONMENT=local\n",
    );
    const journalPath = path.join(stagedRoot, JOURNAL);
    if (!existsSync(journalPath)) {
      throw new Error("The staged migration journal is missing.");
    }
    const stagedWorkspacePackages = workspacePackages(stagedRoot);
    const stagedNodeModules = path.join(stagedRoot, "node_modules");
    const sourceVirtualStore = path.join(ROOT, "node_modules/.pnpm");
    const stagedVirtualStore = path.join(stagedNodeModules, ".pnpm");
    mkdirSync(stagedVirtualStore, { recursive: true });
    for (const entry of readdirSync(sourceVirtualStore)) {
      if (entry === "node_modules") continue;
      symlinkSync(
        path.join(sourceVirtualStore, entry),
        path.join(stagedVirtualStore, entry),
        "dir",
      );
    }
    cpSync(
      path.join(sourceVirtualStore, "node_modules"),
      path.join(stagedVirtualStore, "node_modules"),
      { recursive: true, dereference: false },
    );
    redirectWorkspaceLinks(
      path.join(stagedVirtualStore, "node_modules"),
      stagedWorkspacePackages,
    );
    cpSync(
      path.join(ROOT, DB, "node_modules"),
      path.join(stagedRoot, DB, "node_modules"),
      { recursive: true, dereference: false },
    );
    for (const directory of ["modules", "packages"]) {
      for (const name of readdirSync(path.join(stagedRoot, directory))) {
        const sourceNodeModules = path.join(
          ROOT,
          directory,
          name,
          "node_modules",
        );
        if (directory === "packages" && name === "db") continue;
        if (!existsSync(sourceNodeModules)) continue;
        cpSync(
          sourceNodeModules,
          path.join(stagedRoot, directory, name, "node_modules"),
          { recursive: true, dereference: false },
        );
      }
    }
    for (const directory of ["modules", "packages"]) {
      for (const name of readdirSync(path.join(stagedRoot, directory))) {
        const nodeModulesPath = path.join(
          stagedRoot,
          directory,
          name,
          "node_modules",
        );
        if (existsSync(nodeModulesPath)) {
          redirectWorkspaceLinks(nodeModulesPath, stagedWorkspacePackages);
        }
      }
    }
    return tempRoot;
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function generateProbe(stagedRoot) {
  const dbDir = path.join(stagedRoot, DB);
  const migrationDir = path.join(stagedRoot, MIGRATIONS);
  const listFiles = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    });
  const before = new Set(listFiles(migrationDir));
  const generator = path.join(dbDir, "scripts/generate-migration.mjs");
  run(process.execPath, [generator, "staged-schema-validation"], {
    cwd: dbDir,
    env: {
      ...process.env,
      NODE_OPTIONS: [
        Reflect.get(process.env, "NODE_OPTIONS"),
        "--conditions=development",
      ]
        .filter(Boolean)
        .join(" "),
      PATH: `${path.join(dbDir, "node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
  const generated = listFiles(migrationDir);
  if (generated.some((file) => !before.has(file))) {
    throw new Error(
      "A database schema change requires a staged migration; Drizzle generated migration artifacts from the staged schema.",
    );
  }
}

function validate() {
  const paths = stagedDatabasePaths().filter(isSchemaValidationPath);
  if (!paths.length) return;

  checkExistingHistory();
  const additions = stagedMigrationAdditions();
  const stagedRoot = prepareStagedCheckout();
  try {
    const drizzle = path.join(ROOT, DB, "node_modules/drizzle-kit/bin.cjs");
    run(process.execPath, [drizzle, "check"], {
      cwd: path.join(stagedRoot, DB),
    });
    if (!additions.length) {
      generateProbe(stagedRoot);
      return;
    }
    const candidate = validateCandidate(stagedRoot);
    const migrationName = migrationNameFromTag(candidate.entry.tag);
    const probeRoot = prepareCandidateGeneration(stagedRoot, candidate);
    try {
      const probe = runInteractiveGenerator(probeRoot, migrationName, "probe");
      if (!probe.promptSeen) {
        if (probe.exitCode !== 0) {
          throw new Error(
            `Canonical Drizzle generation failed:\n${probe.transcript}`,
          );
        }
        compareGenerated(stagedRoot, probeRoot, candidate);
        return;
      }
      if (probe.options.length < 1) {
        throw new Error(
          "Drizzle's interactive decision did not expose its candidate options.",
        );
      }
      const mismatches = [];
      let canonicalMatch = false;
      for (
        let optionIndex = 0;
        optionIndex < probe.options.length;
        optionIndex += 1
      ) {
        const generatedRoot = prepareCandidateGeneration(stagedRoot, candidate);
        try {
          const generated = runInteractiveGenerator(
            generatedRoot,
            migrationName,
            "select",
            optionIndex,
          );
          assertNoSecondDecision(generated);
          if (generated.exitCode !== 0) {
            mismatches.push(
              `${probe.options[optionIndex]}: generation exited ${generated.exitCode}`,
            );
            continue;
          }
          try {
            compareGenerated(stagedRoot, generatedRoot, candidate);
            canonicalMatch = true;
          } catch (error) {
            mismatches.push(`${probe.options[optionIndex]}: ${error.message}`);
          }
        } finally {
          rmSync(generatedRoot, { recursive: true, force: true });
        }
      }
      if (canonicalMatch) return;
      throw new Error(
        `No canonical Drizzle decision candidate matches all staged migration artifacts.\n${mismatches.join("\n")}`,
      );
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(stagedRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    validate();
  } catch (error) {
    process.stderr.write(
      `Staged migration validation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  assertExistingHistoryUnchanged,
  compareGeneratedJournalEntry,
  compareJson,
  compareSql,
  isSchemaValidationPath,
  migrationNameFromTag,
  normalizeSnapshot,
  validate,
  validateCandidateData,
};

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertExistingHistoryUnchanged,
  compareGeneratedJournalEntry,
  compareJson,
  compareSql,
  isSchemaValidationPath,
  migrationNameFromTag,
  normalizeSnapshot,
  validateCandidateData,
} from "./validate-staged-migrations.mjs";

const previousEntry = {
  idx: 0,
  version: "7",
  when: 1,
  tag: "0000_init",
  breakpoints: true,
};
const candidateEntry = {
  idx: 1,
  version: "7",
  when: 2,
  tag: "0001_add_column",
  breakpoints: true,
};
const headJournal = {
  version: "7",
  dialect: "postgresql",
  entries: [previousEntry],
};
const stagedJournal = {
  ...headJournal,
  entries: [previousEntry, candidateEntry],
};
const sqlPath = "packages/db/migrations/0001_add_column.sql";
const snapshotPath = "packages/db/migrations/meta/0001_snapshot.json";
const expectedAddedFiles = [sqlPath, snapshotPath];

function validCandidate(overrides = {}) {
  return validateCandidateData({
    stagedJournal,
    headJournal,
    addedFiles: expectedAddedFiles,
    presentFiles: new Set(expectedAddedFiles),
    ...overrides,
  });
}

describe("staged migration validation helpers", () => {
  it("recognizes repository-wide schema and generation inputs", () => {
    for (const file of [
      "packages/db/src/schema.ts",
      "modules/new-module/src/schema/index.ts",
      "packages/db/migrations/meta/_journal.json",
      "packages/db/drizzle.config.ts",
      "packages/db/scripts/generate-migration.mjs",
    ]) {
      assert.equal(isSchemaValidationPath(file), true, file);
    }
    assert.equal(
      isSchemaValidationPath("packages/db/src/schema/index.ts"),
      false,
      "the obsolete schema directory is not a canonical validation input",
    );
    for (const file of [
      "modules/new-module/src/index.ts",
      "packages/db/src/database.ts",
      "README.md",
    ]) {
      assert.equal(isSchemaValidationPath(file), false, file);
    }
  });

  it("allows JSON formatting and object-key order differences", () => {
    compareJson(
      { entries: [{ tag: "0001_example", idx: 1 }], version: "7" },
      { version: "7", entries: [{ idx: 1, tag: "0001_example" }] },
      "journal",
    );
  });

  it("rejects a semantic SQL change and does not strip whitespace", () => {
    assert.throws(() =>
      compareSql("ALTER TABLE users ADD x text;", "DROP TABLE users;"),
    );
    assert.throws(() => compareSql("SELECT  1;", "SELECT 1;"));
  });

  it("normalizes only the observed generated snapshot UUID", () => {
    const first = {
      id: "4b00ca5d-bf91-4fcb-862c-e8e54c356aca",
      prevId: "c611d1e4-f006-44b5-b072-638872373091",
      version: "7",
      tables: { "public.users": { name: "users" } },
    };
    const repeatedGeneration = {
      ...first,
      id: "5ebdb5cf-cf54-4f44-9c32-17d932333855",
    };
    compareJson(
      normalizeSnapshot(first),
      normalizeSnapshot(repeatedGeneration),
      "snapshot",
    );
    assert.throws(() =>
      compareJson(
        normalizeSnapshot(first),
        normalizeSnapshot({ ...repeatedGeneration, prevId: "different" }),
        "snapshot",
      ),
    );
    assert.throws(() =>
      compareJson(
        normalizeSnapshot(first),
        normalizeSnapshot({
          ...repeatedGeneration,
          tables: { "public.users": { name: "changed" } },
        }),
        "snapshot",
      ),
    );
  });

  it("extracts a meaningful name after migration indexes of any observed width", () => {
    assert.equal(migrationNameFromTag("0038_probe"), "probe");
    assert.equal(migrationNameFromTag("10000_probe"), "probe");
  });

  it("rejects changed or deleted existing migrations and snapshots", () => {
    assert.throws(
      () =>
        assertExistingHistoryUnchanged([
          { status: "M", file: "packages/db/migrations/0001_old.sql" },
        ]),
      /cannot be changed or deleted/,
    );
    assert.throws(
      () =>
        assertExistingHistoryUnchanged([
          { status: "D", file: "packages/db/migrations/0001_old.sql" },
        ]),
      /cannot be changed or deleted/,
    );
    assert.throws(
      () =>
        assertExistingHistoryUnchanged([
          {
            status: "M",
            file: "packages/db/migrations/meta/0001_snapshot.json",
          },
        ]),
      /cannot be changed or deleted/,
    );
    assert.throws(
      () =>
        assertExistingHistoryUnchanged([
          {
            status: "D",
            file: "packages/db/migrations/meta/0001_snapshot.json",
          },
        ]),
      /cannot be changed or deleted/,
    );
    assert.doesNotThrow(() =>
      assertExistingHistoryUnchanged([
        { status: "A", file: "packages/db/migrations/0002_new.sql" },
      ]),
    );
  });

  it("requires the staged journal to append exactly one entry unchanged", () => {
    assert.deepEqual(validCandidate(), {
      entry: candidateEntry,
      sql: sqlPath,
      snapshot: snapshotPath,
    });
    assert.throws(
      () =>
        validCandidate({ stagedJournal: { ...stagedJournal, version: "8" } }),
      /append exactly one entry/,
    );
    assert.throws(
      () =>
        validCandidate({
          stagedJournal: { ...stagedJournal, dialect: "sqlite" },
        }),
      /append exactly one entry/,
    );
    assert.throws(
      () =>
        validCandidate({
          stagedJournal: { ...headJournal, entries: [previousEntry] },
        }),
      /append exactly one entry/,
    );
    assert.throws(
      () =>
        validCandidate({
          stagedJournal: {
            ...stagedJournal,
            entries: [{ ...previousEntry, tag: "changed" }, candidateEntry],
          },
        }),
      /Existing migration journal entries/,
    );
  });

  it("validates the appended journal entry metadata", () => {
    for (const [key, value] of [
      ["tag", "1_bad"],
      ["idx", 2],
      ["version", "6"],
      ["when", "2"],
      ["breakpoints", false],
    ]) {
      const malformed = { ...candidateEntry, [key]: value };
      assert.throws(
        () =>
          validCandidate({
            stagedJournal: {
              ...headJournal,
              entries: [previousEntry, malformed],
            },
            addedFiles: [
              `packages/db/migrations/${malformed.tag}.sql`,
              snapshotPath,
            ],
          }),
        /appended migration journal entry is malformed/,
        `expected malformed ${key} to be rejected`,
      );
    }
  });

  it("requires exactly the candidate SQL and indexed snapshot artifacts", () => {
    assert.throws(
      () => validCandidate({ addedFiles: [sqlPath] }),
      /add exactly its SQL and snapshot/,
    );
    assert.throws(
      () =>
        validCandidate({
          addedFiles: [
            sqlPath,
            snapshotPath,
            "packages/db/migrations/extra.sql",
          ],
        }),
      /add exactly its SQL and snapshot/,
    );
    assert.throws(
      () => validCandidate({ presentFiles: new Set([sqlPath]) }),
      /SQL or snapshot is missing/,
    );
    assert.throws(
      () => validCandidate({ presentFiles: new Set([snapshotPath]) }),
      /SQL or snapshot is missing/,
    );
  });

  it("allows only the generated journal timestamp to differ", () => {
    compareGeneratedJournalEntry(
      { ...candidateEntry, when: 3 },
      candidateEntry,
    );
    assert.throws(() =>
      compareGeneratedJournalEntry(
        { ...candidateEntry, when: 3, tag: "0001_changed" },
        candidateEntry,
      ),
    );
  });
});

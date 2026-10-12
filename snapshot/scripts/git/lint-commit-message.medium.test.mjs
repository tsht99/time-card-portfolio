import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function lintFromStdin(message) {
  return spawnSync(pnpm, ["lint:commit"], { input: message, encoding: "utf8" });
}

test("accepts a conventional commit with Japanese subject and correct spacing from stdin", () => {
  const result = lintFromStdin("docs: AI ワークフローの用語を整理する\n");
  assert.equal(result.status, 0, result.stderr);
});

test("reports both commitlint and textlint diagnostics for one invalid stdin message", () => {
  const result = lintFromStdin("invalid: AIワークフローの用語を整理する\n");
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /type-enum/u);
  assert.match(
    result.stdout + result.stderr,
    /ja-space-between-half-and-full-width/u,
  );
});

test("lints an --edit file with a custom Git comment character", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "timecard-commit-message-"),
  );
  try {
    const file = path.join(directory, "message.txt");
    writeFileSync(
      file,
      "; invalid: AIワークフロー\ndocs: AI ワークフローの用語を整理する\n",
    );
    const result = spawnSync(pnpm, ["lint:commit", "--edit", file], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.commentChar",
        GIT_CONFIG_VALUE_0: ";",
      },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Git stripspace removes default hash comment lines", () => {
  const result = spawnSync("git", ["stripspace", "--strip-comments"], {
    input:
      "docs: AI ワークフローの用語を整理する\n\n# invalid: AIワークフロー\n",
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "docs: AI ワークフローの用語を整理する\n");
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  lintCommitMessage,
  readCommitMessage,
} from "./lint-commit-message.mjs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function lintFromStdin(message) {
  return spawnSync(pnpm, ["lint:commit"], {
    input: message,
    encoding: "utf8",
  });
}

test("accepts a conventional commit with Japanese subject and correct spacing from stdin", () => {
  const result = lintFromStdin("docs: AI ワークフローの用語を整理する\n");
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a textlint violation from stdin", () => {
  const result = lintFromStdin("docs: AIワークフローの用語を整理する\n");
  assert.equal(result.status, 1);
  assert.match(
    result.stdout + result.stderr,
    /ja-space-between-half-and-full-width/u,
  );
});

test("rejects a commitlint violation from stdin", () => {
  const result = lintFromStdin("invalid: AI ワークフローの用語を整理する\n");
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /type-enum/u);
});

test("reads a local commit message from --edit", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "timecard-commit-message-"),
  );
  try {
    const file = path.join(directory, "message.txt");
    const message = "docs: AI ワークフローの用語を整理する\n";
    writeFileSync(file, message);
    assert.deepEqual(readCommitMessage(["--edit", file]), {
      message,
      editPath: file,
    });
    const result = spawnSync(pnpm, ["lint:commit", "--edit", file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ignores Git comment lines in a local message file", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "timecard-commit-message-"),
  );
  try {
    const file = path.join(directory, "message.txt");
    writeFileSync(
      file,
      "docs: AI ワークフローの用語を整理する\n\n# invalid: AIワークフロー\n",
    );
    const result = spawnSync(pnpm, ["lint:commit", "--edit", file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uses core.commentChar to ignore local Git comment lines", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "timecard-commit-message-"),
  );
  try {
    const file = path.join(directory, "message.txt");
    writeFileSync(
      file,
      "docs: AI ワークフローの用語を整理する\n\n; invalid: AIワークフロー\n",
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

test("passes --edit directly to commitlint", () => {
  const called = [];
  const result = lintCommitMessage("docs: AI ワークフローの用語を整理する\n", {
    editPath: "/commit-message",
    run: (command, args, options) => {
      called.push([command, args, options.input]);
      return { status: 0, stdout: "docs: AI ワークフローの用語を整理する\n" };
    },
  });
  assert.equal(result, 0);
  assert.deepEqual(called[0][1], [
    "exec",
    "commitlint",
    "--verbose",
    "--edit",
    "/commit-message",
  ]);
  assert.equal(called[0][2], undefined);
  assert.deepEqual(called[1].slice(0, 2), [
    "git",
    ["stripspace", "--strip-comments"],
  ]);
  assert.equal(called[2][2], "docs: AI ワークフローの用語を整理する\n");
});

test("runs both validators even when one fails", () => {
  for (const failedCommand of ["commitlint", "textlint"]) {
    const called = [];
    const result = lintCommitMessage("docs: AI ワークフローの用語を整理する", {
      run: (_command, args, options) => {
        called.push(args[1]);
        assert.equal(options.input, "docs: AI ワークフローの用語を整理する");
        return { status: args[1] === failedCommand ? 1 : 0 };
      },
    });
    assert.equal(result, 1);
    assert.deepEqual(called, ["commitlint", "textlint"]);
  }
});

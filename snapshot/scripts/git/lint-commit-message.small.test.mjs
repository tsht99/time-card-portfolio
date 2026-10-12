import assert from "node:assert/strict";
import test from "node:test";
import {
  lintCommitMessage,
  readCommitMessage,
} from "./lint-commit-message.mjs";

test("reads stdin when no arguments are supplied", () => {
  assert.deepEqual(
    readCommitMessage([], {
      readFile: (file, encoding) => {
        assert.equal(file, 0);
        assert.equal(encoding, "utf8");
        return "docs: AI ワークフローの用語を整理する\n";
      },
    }),
    { message: "docs: AI ワークフローの用語を整理する\n" },
  );
});

test("reads the --edit path and preserves it for commitlint", () => {
  const called = [];
  const message = "docs: AI ワークフローの用語を整理する\n";
  const parsed = readCommitMessage(["--edit", "/commit-message"], {
    readFile: (file, encoding) => {
      assert.equal(file, "/commit-message");
      assert.equal(encoding, "utf8");
      return message;
    },
  });

  assert.deepEqual(parsed, { message, editPath: "/commit-message" });
  assert.equal(
    lintCommitMessage(parsed.message, {
      editPath: parsed.editPath,
      run: (command, args, options) => {
        called.push({ command, args, options });
        if (command === "git") {
          return { status: 0, stdout: message };
        }
        return { status: 0 };
      },
    }),
    0,
  );
  assert.deepEqual(called[0].args, [
    "exec",
    "commitlint",
    "--verbose",
    "--edit",
    "/commit-message",
  ]);
  assert.equal(called[0].options.input, undefined);
  assert.deepEqual(called[1].args, ["stripspace", "--strip-comments"]);
  assert.equal(called[1].options.input, message);
  assert.equal(called[2].options.input, message);
});

test("runs both validators when either validator fails", () => {
  for (const failedValidator of ["commitlint", "textlint"]) {
    const called = [];
    const result = lintCommitMessage("docs: AI ワークフローの用語を整理する", {
      run: (_command, args, options) => {
        const validator = args[1];
        called.push(validator);
        assert.equal(options.input, "docs: AI ワークフローの用語を整理する");
        return { status: validator === failedValidator ? 1 : 0 };
      },
    });
    assert.equal(result, 1);
    assert.deepEqual(called, ["commitlint", "textlint"]);
  }
});

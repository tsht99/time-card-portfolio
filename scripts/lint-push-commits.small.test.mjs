import assert from "node:assert/strict";
import test from "node:test";
import {
  lintPushCommits,
  parsePushPayload,
  readPushEventPayload,
  runPushCommitLint,
} from "./lint-push-commits.mjs";

function payloadWithMessages(...messages) {
  return { commits: messages.map((message) => ({ message })) };
}

test("lints every pushed commit in event order", () => {
  const messages = ["feat: 最初の変更", "fix: 次の変更"];
  const linted = [];

  const exitCode = runPushCommitLint({
    eventPath: "/event.json",
    readFile: () => JSON.stringify(payloadWithMessages(...messages)),
    lintRunner: (message) => {
      linted.push(message);
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(linted, messages);
});

test("does not derive or lint commits outside the push event", () => {
  const linted = [];
  const exitCode = runPushCommitLint({
    eventPath: "/event.json",
    readFile: () =>
      JSON.stringify({
        before: "unreachable-before-sha",
        commits: [{ id: "pushed-sha", message: "feat: pushed change" }],
      }),
    lintRunner: (message) => {
      linted.push(message);
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(linted, ["feat: pushed change"]);
});

test("continues after a lint failure and returns failure", () => {
  const linted = [];
  const errors = [];
  const exitCode = lintPushCommits(
    ["feat: first", "bad message", "fix: last"],
    {
      lintRunner: (message) => {
        linted.push(message);
        return message === "bad message" ? 1 : 0;
      },
      write: (message) => errors.push(message),
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(linted, ["feat: first", "bad message", "fix: last"]);
  assert.deepEqual(errors, [
    "commit message lint failed for pushed commit at index 1",
  ]);
});

test("returns success when all commits pass", () => {
  assert.equal(
    lintPushCommits(["feat: one", "fix: two"], { lintRunner: () => 0 }),
    0,
  );
});

test("returns success when the push contains no commits", () => {
  assert.equal(lintPushCommits([], { lintRunner: () => 1 }), 0);
  assert.deepEqual(parsePushPayload({ commits: [] }), []);
});

test("fails closed for malformed payloads and invalid commit entries", () => {
  assert.throws(() => parsePushPayload(null), /payload must be an object/u);
  assert.throws(() => parsePushPayload({}), /commits must be an array/u);
  assert.throws(
    () => parsePushPayload({ commits: [{ message: 123 }] }),
    /no string message/u,
  );
  assert.throws(
    () => readPushEventPayload("/event.json", { readFile: () => "{" }),
    /not valid JSON/u,
  );
});

test("fails rather than silently partially validating a 2048-commit payload", () => {
  assert.throws(
    () =>
      parsePushPayload({
        commits: Array.from({ length: 2048 }, () => ({
          message: "feat: change",
        })),
      }),
    /complete commit set cannot be guaranteed/u,
  );
});

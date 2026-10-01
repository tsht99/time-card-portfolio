import assert from "node:assert/strict";
import test from "node:test";
import {
  AttendanceCurrentStateProjectionRebuildError,
  createAttendanceCurrentStateProjectionRebuildError,
} from "./attendance-current-state-projection-rebuild-error.ts";

const validAttendanceId = "66666666-6666-4666-8666-666666666666";

test("rebuild diagnostic errorは元errorのmessageとcauseを保持しない", () => {
  const source = new Error("synthetic-secret-marker");
  const diagnostic = createAttendanceCurrentStateProjectionRebuildError(
    "read_event_store",
    source,
    validAttendanceId,
  );

  assert.equal(
    diagnostic.message,
    "Attendance Current State Projection rebuild failed.",
  );
  assert.equal(Object.hasOwn(diagnostic, "cause"), false);
  assert.equal(Object.hasOwn(diagnostic, "sourceError"), false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /synthetic-secret-marker/);
});

test("source stackはfunction name、path、URL、queryを保持せず数値frameだけにする", () => {
  const source = new Error("synthetic-secret-marker");
  source.stack =
    "Error: synthetic-secret-marker\n" +
    "    at secretFunction (https://user:synthetic-secret-marker@example.test/path?secret=synthetic-secret-marker:10:20)\n" +
    "    at /private/synthetic-secret-marker/file.ts:30:40";

  const diagnostic = createAttendanceCurrentStateProjectionRebuildError(
    "read_event_store",
    source,
  );

  assert.deepEqual(diagnostic.sourceStackFrames, [
    "at <anonymous> (10:20)",
    "at <anonymous> (30:40)",
  ]);
  assert.doesNotMatch(
    diagnostic.sourceStackFrames.join("\n"),
    /synthetic-secret-marker|secretFunction|example\.test|query|path/,
  );
});

test("Error以外のsourceと不正なattendanceIdは保持しない", () => {
  const diagnostic = createAttendanceCurrentStateProjectionRebuildError(
    "read_event_store",
    { secret: "synthetic-secret-marker" },
    "not-an-attendance-id",
  );

  assert.equal(diagnostic.sourceErrorType, "Error");
  assert.equal(Object.hasOwn(diagnostic, "attendanceId"), false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /synthetic-secret-marker/);
});

test("stack getterが失敗してもdiagnostic化は失敗しない", () => {
  const source = new Error("synthetic-secret-marker");
  Object.defineProperty(source, "stack", {
    configurable: true,
    get() {
      throw new Error("stack getter secret");
    },
  });

  assert.doesNotThrow(() =>
    createAttendanceCurrentStateProjectionRebuildError(
      "read_event_store",
      source,
    ),
  );
});

test("既存のrebuild diagnostic errorは外側のstageで上書きしない", () => {
  const inner = createAttendanceCurrentStateProjectionRebuildError(
    "deserialize_event",
    new Error("synthetic-secret-marker"),
    validAttendanceId,
  );
  const outer = createAttendanceCurrentStateProjectionRebuildError(
    "replace_projection_transaction",
    inner,
    "77777777-7777-4777-8777-777777777777",
  );

  assert.strictEqual(outer, inner);
  assert.equal(outer.stage, "deserialize_event");
  assert.equal(outer.attendanceId, validAttendanceId);
  assert.ok(outer instanceof AttendanceCurrentStateProjectionRebuildError);
});

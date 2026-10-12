import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceCurrentStateProjectionRebuildError } from "@repo/attendance/infrastructure";
import { formatAttendanceCurrentStateProjectionRebuildFailure } from "./rebuild-attendance-current-state-projection-error-output.ts";

const genericFailureMessage =
  "Attendance Current State Projection rebuild failed.";
const validAttendanceId = "66666666-6666-4666-8666-666666666666";

test("diagnostic errorは安全な診断情報だけを出力する", () => {
  const source = new Error("synthetic-secret-marker");
  source.stack =
    "SecretError: synthetic-secret-marker\n" +
    "    at secretFunction (https://user:synthetic-secret-marker@example.test/path?query=synthetic-secret-marker:42:17)";
  const diagnostic = new AttendanceCurrentStateProjectionRebuildError(
    "deserialize_event",
    source,
    validAttendanceId,
  );

  const output =
    formatAttendanceCurrentStateProjectionRebuildFailure(diagnostic);

  assert.match(output, new RegExp(`^${genericFailureMessage}\\n`));
  assert.match(output, /stage=deserialize_event/);
  assert.match(output, new RegExp(`attendanceId=${validAttendanceId}`));
  assert.match(output, /errorType=Error/);
  assert.match(output, /at <anonymous> \(42:17\)/);
  assert.doesNotMatch(output, /synthetic-secret-marker/);
  assert.doesNotMatch(output, /secretFunction|example\.test|query|path/);
  assert.doesNotMatch(output, /Error: synthetic-secret-marker/);
});

test("attendanceIdがなくstack frameもない場合は該当行を省略する", () => {
  const diagnostic = new AttendanceCurrentStateProjectionRebuildError(
    "read_event_store",
    { notAnError: true },
  );

  const output =
    formatAttendanceCurrentStateProjectionRebuildFailure(diagnostic);

  assert.match(output, /stage=read_event_store/);
  assert.match(output, /errorType=Error/);
  assert.doesNotMatch(output, /attendanceId=/);
  assert.doesNotMatch(output, /stack:/);
});

test("diagnostic error以外は固定文言だけを返す", () => {
  assert.equal(
    formatAttendanceCurrentStateProjectionRebuildFailure(
      new Error("synthetic-secret-marker"),
    ),
    genericFailureMessage,
  );
  assert.equal(
    formatAttendanceCurrentStateProjectionRebuildFailure(
      "synthetic-secret-marker",
    ),
    genericFailureMessage,
  );
});

test("異常なunknown valueの判定で例外を投げず固定文言へ戻す", () => {
  const suspiciousValue = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("synthetic-secret-marker");
      },
    },
  );

  assert.doesNotThrow(() => {
    assert.equal(
      formatAttendanceCurrentStateProjectionRebuildFailure(suspiciousValue),
      genericFailureMessage,
    );
  });
});

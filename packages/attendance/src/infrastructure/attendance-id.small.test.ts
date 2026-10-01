import assert from "node:assert/strict";
import test from "node:test";
import { isSafeAttendanceId } from "./attendance-id.ts";

test("safe attendance ID accepts UUID-shaped strings without case sensitivity", () => {
  assert.equal(
    isSafeAttendanceId("66666666-6666-4666-8666-666666666666"),
    true,
  );
  assert.equal(
    isSafeAttendanceId("ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB"),
    true,
  );
});

test("safe attendance ID rejects malformed values and non-strings", () => {
  for (const value of [
    "not-an-attendance-id",
    "66666666666646668666666666666666",
    "66666666-6666-4666-8666-66666666666",
    "66666666-6666-4666-8666-66666666666g",
    "",
    null,
    undefined,
    123,
  ]) {
    assert.equal(isSafeAttendanceId(value), false);
  }
});

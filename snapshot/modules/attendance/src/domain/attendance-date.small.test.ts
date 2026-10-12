import assert from "node:assert/strict";
import test from "node:test";
import { deriveAttendanceDateFromClockInAt } from "./attendance-date.ts";

function assertInvalidAttendanceDateTimeError(
  error: unknown,
  field: string,
): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "InvalidAttendanceDateTimeError");
  assert.equal(error.message, `Attendance ${field} must be a valid Date.`);
  return true;
}

test("clockInAtからJST基準のカレンダー日付を導出できる", () => {
  assert.equal(
    deriveAttendanceDateFromClockInAt(new Date("2026-08-24T09:30:00.000Z")),
    "2026-08-24",
  );
});

test("UTCでは前日でもJSTでは翌日になる境界を扱える", () => {
  assert.equal(
    deriveAttendanceDateFromClockInAt(new Date("2026-08-24T15:30:00.000Z")),
    "2026-08-25",
  );
});

test("月跨ぎをJST基準で扱える", () => {
  assert.equal(
    deriveAttendanceDateFromClockInAt(new Date("2026-01-31T15:30:00.000Z")),
    "2026-02-01",
  );
});

test("年跨ぎをJST基準で扱える", () => {
  assert.equal(
    deriveAttendanceDateFromClockInAt(new Date("2026-12-31T15:30:00.000Z")),
    "2027-01-01",
  );
});

test("Invalid Dateを拒否する", () => {
  assert.throws(
    () => deriveAttendanceDateFromClockInAt(new Date("invalid")),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockInAt"),
  );
});

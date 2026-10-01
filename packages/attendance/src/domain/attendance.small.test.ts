import assert from "node:assert/strict";
import test from "node:test";

import { calculateWorkedMinutes } from "./attendance.ts";

test("calculateWorkedMinutes calculates elapsed whole minutes", () => {
  const clockInAt = new Date("2026-01-01T09:00:00.000Z");
  const clockOutAt = new Date("2026-01-01T17:30:00.000Z");

  assert.equal(calculateWorkedMinutes(clockInAt, clockOutAt), 510);
});

test("calculateWorkedMinutes truncates elapsed minutes", () => {
  const clockInAt = new Date("2026-01-01T09:00:00.000Z");
  const cases = [
    { elapsedMilliseconds: 59_999, expectedMinutes: 0 },
    { elapsedMilliseconds: 60_000, expectedMinutes: 1 },
    { elapsedMilliseconds: 60_001, expectedMinutes: 1 },
    { elapsedMilliseconds: 119_999, expectedMinutes: 1 },
    { elapsedMilliseconds: 120_000, expectedMinutes: 2 },
  ];

  for (const { elapsedMilliseconds, expectedMinutes } of cases) {
    const clockOutAt = new Date(clockInAt.getTime() + elapsedMilliseconds);

    assert.equal(
      calculateWorkedMinutes(clockInAt, clockOutAt),
      expectedMinutes,
      `${elapsedMilliseconds}ms should be ${expectedMinutes} minute(s)`,
    );
  }
});

test("calculateWorkedMinutes throws RangeError for invalid dates", () => {
  const validDate = new Date("2026-01-01T09:00:00.000Z");

  for (const [clockInAt, clockOutAt] of [
    [new Date("invalid"), validDate],
    [validDate, new Date("invalid")],
  ]) {
    assert.throws(
      () => calculateWorkedMinutes(clockInAt, clockOutAt),
      RangeError,
    );
  }
});

test("calculateWorkedMinutes throws RangeError when clock-out is earlier", () => {
  const clockInAt = new Date("2026-01-01T09:00:00.000Z");
  const clockOutAt = new Date("2026-01-01T08:59:59.999Z");

  assert.throws(
    () => calculateWorkedMinutes(clockInAt, clockOutAt),
    RangeError,
  );
});

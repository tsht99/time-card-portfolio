import assert from "node:assert/strict";
import test from "node:test";

import { getTokyoMonthRange } from "@repo/attendance";

test("Asia/Tokyo基準の月範囲は月初を含み翌月月初を含まない", () => {
  const { startAt, endExclusiveAt } = getTokyoMonthRange("2026-08");

  assert.equal(startAt.toISOString(), "2026-07-31T15:00:00.000Z");
  assert.equal(endExclusiveAt.toISOString(), "2026-08-31T15:00:00.000Z");
  assert.equal(new Date("2026-08-01T00:00:00+09:00") >= startAt, true);
  assert.equal(new Date("2026-09-01T00:00:00+09:00") < endExclusiveAt, false);
});

test("12月の月範囲は翌年1月へ進む", () => {
  const { startAt, endExclusiveAt } = getTokyoMonthRange("2026-12");

  assert.equal(startAt.toISOString(), "2026-11-30T15:00:00.000Z");
  assert.equal(endExclusiveAt.toISOString(), "2026-12-31T15:00:00.000Z");
});

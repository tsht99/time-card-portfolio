import assert from "node:assert/strict";
import test from "node:test";

import { getTokyoMonthRange } from "./tokyo-date.ts";

test("Asia/Tokyo基準の月範囲は月初を含み翌月月初を含まない", () => {
  const { startAt, endExclusiveAt } = getTokyoMonthRange("2026-08");

  assert.equal(startAt.toISOString(), "2026-07-31T15:00:00.000Z");
  assert.equal(endExclusiveAt.toISOString(), "2026-08-31T15:00:00.000Z");
  assert.equal(new Date("2026-08-01T00:00:00+09:00") >= startAt, true);
  assert.equal(new Date("2026-09-01T00:00:00+09:00") < endExclusiveAt, false);
});

test("11月の月範囲は12月へ進む", () => {
  const { startAt, endExclusiveAt } = getTokyoMonthRange("2026-11");

  assert.equal(startAt.toISOString(), "2026-10-31T15:00:00.000Z");
  assert.equal(endExclusiveAt.toISOString(), "2026-11-30T15:00:00.000Z");
});

test("西暦境界の東京月初と翌月月初を計算する", () => {
  for (const [month, startAt, endExclusiveAt] of [
    ["0099-12", "0099-11-30T15:00:00.000Z", "0099-12-31T15:00:00.000Z"],
    ["0100-01", "0099-12-31T15:00:00.000Z", "0100-01-31T15:00:00.000Z"],
    ["2026-12", "2026-11-30T15:00:00.000Z", "2026-12-31T15:00:00.000Z"],
    ["9999-11", "9999-10-31T15:00:00.000Z", "9999-11-30T15:00:00.000Z"],
  ] as const) {
    const range = getTokyoMonthRange(month);
    assert.equal(range.startAt.toISOString(), startAt);
    assert.equal(range.endExclusiveAt.toISOString(), endExclusiveAt);
  }
  assert.throws(() => getTokyoMonthRange("9999-12"));
});

test("1年から9999年の月初を数値で計算し、範囲外を拒否する", () => {
  const first = getTokyoMonthRange("0001-01");
  assert.equal(first.startAt.toISOString(), "0000-12-31T15:00:00.000Z");
  assert.equal(first.endExclusiveAt.toISOString(), "0001-01-31T15:00:00.000Z");
  assert.throws(() => getTokyoMonthRange("0000-01"));
  assert.throws(() => getTokyoMonthRange("9999-12"));
});

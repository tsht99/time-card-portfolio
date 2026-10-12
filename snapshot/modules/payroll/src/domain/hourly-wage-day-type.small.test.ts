import assert from "node:assert/strict";
import test from "node:test";

import { getHourlyWageDayType } from "./hourly-wage-day-type.ts";

test("通常の月曜日はmonを返す", () => {
  assert.equal(getHourlyWageDayType("2026-04-06"), "mon");
});

test("通常の日曜日はsunを返す", () => {
  assert.equal(getHourlyWageDayType("2026-04-05"), "sun");
});

test("平日の祝日はholidayを返す", () => {
  assert.equal(getHourlyWageDayType("2026-05-04"), "holiday");
});

test("日曜日と重なる祝日もholidayを返す", () => {
  assert.equal(getHourlyWageDayType("2026-05-03"), "holiday");
});

test("振替休日はholidayを返す", () => {
  assert.equal(getHourlyWageDayType("2026-05-06"), "holiday");
});

test("不正な日付は拒否する", () => {
  assert.throws(() => getHourlyWageDayType("2026-02-30"), RangeError);
  assert.throws(() => getHourlyWageDayType("2026/04/06"), RangeError);
});

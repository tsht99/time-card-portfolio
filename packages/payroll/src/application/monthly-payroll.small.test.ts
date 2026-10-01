import assert from "node:assert/strict";
import test from "node:test";
import type { HourlyWageRate } from "../domain/hourly-wage-rate.ts";
import { summarizeMonthlyPayroll } from "../domain/monthly-payroll-summary.ts";
import type { PayrollAttendanceCurrentState } from "./monthly-payroll.ts";
import {
  buildMonthlyPayrollAttendances,
  buildMonthlyPayrollDetailAttendances,
} from "./monthly-payroll.ts";

const clockInAt = new Date("2026-05-01T09:00:00Z");
const clockOutAt = new Date("2026-05-01T18:00:00Z");

function state(
  overrides: Partial<PayrollAttendanceCurrentState> = {},
): PayrollAttendanceCurrentState {
  return {
    attendanceId: "attendance-1",
    userId: "user-1",
    attendanceDate: "2026-05-01",
    workPeriod: "day",
    clockInAt,
    clockOutAt,
    ...overrides,
  };
}

function rate(overrides: Partial<HourlyWageRate> = {}): HourlyWageRate {
  return {
    userId: "user-1",
    workPeriod: "day",
    dayType: "fri",
    hourlyWage: 1200,
    effectiveFrom: "2026-01-01",
    ...overrides,
  };
}

test("各勤怠日にはその日に有効な時給ルールを使用する", () => {
  const [attendance] = buildMonthlyPayrollAttendances(
    [state()],
    [
      rate({ effectiveFrom: "2026-01-01", hourlyWage: 1000 }),
      rate({ effectiveFrom: "2026-06-01", hourlyWage: 2000 }),
    ],
    "2026-05",
  );

  assert.equal(attendance?.hourlyWage, 1000);
  assert.equal(attendance?.attendanceDate, "2026-05-01");
  assert.equal(attendance && "workPeriod" in attendance, false);
});

test("勤怠日は適用中の最新ルールを使用する", () => {
  const [attendance] = buildMonthlyPayrollAttendances(
    [state()],
    [
      rate({ effectiveFrom: "2026-01-01", hourlyWage: 1200 }),
      rate({
        effectiveFrom: "2026-05-01",
        dayType: "fri",
        hourlyWage: 1400,
      }),
    ],
    "2026-05",
  );

  assert.equal(attendance?.hourlyWage, 1400);
});

test("勤怠は昼夜・曜日・祝日を区別してルールを選ぶ", () => {
  const [day, night, sunday, holiday] = buildMonthlyPayrollAttendances(
    [
      state({ attendanceId: "day", workPeriod: "day" }),
      state({
        attendanceId: "night",
        workPeriod: "night",
      }),
      state({
        attendanceId: "sunday",
        attendanceDate: "2026-05-10",
        workPeriod: "day",
      }),
      state({
        attendanceId: "holiday",
        attendanceDate: "2026-05-04",
        workPeriod: "day",
      }),
    ],
    [
      rate({ dayType: "fri", hourlyWage: 1100 }),
      rate({ dayType: "fri", workPeriod: "night", hourlyWage: 1300 }),
      rate({ dayType: "sun", hourlyWage: 1500 }),
      rate({ dayType: "holiday", hourlyWage: 1700 }),
    ],
    "2026-05",
  );

  assert.deepEqual(
    [
      day?.hourlyWage,
      night?.hourlyWage,
      sunday?.hourlyWage,
      holiday?.hourlyWage,
    ],
    [1100, 1300, 1500, 1700],
  );
});

test("適用可能なルールがない勤怠は時給nullになり、対象年月外は除外される", () => {
  const result = buildMonthlyPayrollAttendances(
    [
      state({ attendanceId: "in-month" }),
      state({
        attendanceId: "out-of-month",
        attendanceDate: "2026-06-01",
      }),
    ],
    [],
    "2026-05",
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.hourlyWage, null);
});

test("対象月はlegacy workDateではなくattendanceDate基準で判定する", () => {
  const result = buildMonthlyPayrollAttendances(
    [
      state({
        attendanceId: "attendance-date-in-month",
        attendanceDate: "2026-05-01",
      }),
      state({
        attendanceId: "attendance-date-out-of-month",
        attendanceDate: "2026-06-01",
      }),
    ],
    [],
    "2026-05",
  );

  assert.deepEqual(
    result.map((attendance) => attendance.attendanceDate),
    ["2026-05-01"],
  );
});

test("clockOutAtがnullの不完全勤怠も給与集計用データに残す", () => {
  const [attendance] = buildMonthlyPayrollAttendances(
    [state({ clockOutAt: null })],
    [],
    "2026-05",
  );

  assert.equal(attendance?.clockOutAt, null);
});

test("時刻不明退勤は給与集計で不完全として給与に含めない", () => {
  const [attendance] = buildMonthlyPayrollAttendances(
    [state({ clockOutAt: null })],
    [],
    "2026-05",
  );
  assert.ok(attendance);
  const [summary] = summarizeMonthlyPayroll([attendance], "2026-05");
  assert.equal(summary?.incompleteCount, 1);
  assert.equal(summary?.totalEstimatedPayYen, 0);
});

test("給与詳細用入力はattendanceIdとworkPeriodを保持し、同日同区分の勤怠を統合しない", () => {
  const result = buildMonthlyPayrollDetailAttendances(
    [
      state({ attendanceId: "attendance-2" }),
      state({ attendanceId: "attendance-1" }),
    ],
    [rate()],
    "2026-05",
  );

  assert.deepEqual(
    result.map(({ attendanceId, userId, attendanceDate, workPeriod }) => ({
      attendanceId,
      userId,
      attendanceDate,
      workPeriod,
    })),
    [
      {
        attendanceId: "attendance-2",
        userId: "user-1",
        attendanceDate: "2026-05-01",
        workPeriod: "day",
      },
      {
        attendanceId: "attendance-1",
        userId: "user-1",
        attendanceDate: "2026-05-01",
        workPeriod: "day",
      },
    ],
  );
});

test("給与詳細用入力も昼夜・曜日・祝日・適用開始日の時給選択を共有する", () => {
  const [day, night, sunday, holiday] = buildMonthlyPayrollDetailAttendances(
    [
      state({ attendanceId: "day" }),
      state({ attendanceId: "night", workPeriod: "night" }),
      state({
        attendanceId: "sunday",
        attendanceDate: "2026-05-10",
      }),
      state({
        attendanceId: "holiday",
        attendanceDate: "2026-05-04",
      }),
    ],
    [
      rate({ dayType: "fri", hourlyWage: 1100 }),
      rate({ dayType: "fri", workPeriod: "night", hourlyWage: 1300 }),
      rate({ dayType: "sun", hourlyWage: 1500 }),
      rate({ dayType: "holiday", hourlyWage: 1700 }),
    ],
    "2026-05",
  );

  assert.deepEqual(
    [
      day?.hourlyWage,
      night?.hourlyWage,
      sunday?.hourlyWage,
      holiday?.hourlyWage,
    ],
    [1100, 1300, 1500, 1700],
  );
});

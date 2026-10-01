// cspell:ignore uncomputed

import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateUserMonthlyPayrollDetail,
  type MonthlyPayrollAttendance,
  type MonthlyPayrollDetailAttendance,
  summarizeMonthlyPayroll,
} from "./monthly-payroll-summary.ts";

function attendance(
  overrides: Partial<MonthlyPayrollAttendance> = {},
): MonthlyPayrollAttendance {
  return {
    userId: "staff-1",
    attendanceDate: "2026-08-10",
    clockInAt: new Date("2026-08-10T09:00:00Z"),
    clockOutAt: new Date("2026-08-10T17:00:00Z"),
    hourlyWage: 1200,
    ...overrides,
  };
}

function payrollAttendance(
  overrides: Partial<MonthlyPayrollDetailAttendance> = {},
): MonthlyPayrollDetailAttendance {
  return {
    attendanceId: "attendance-1",
    userId: "staff-1",
    attendanceDate: "2026-08-10",
    workPeriod: "day",
    clockInAt: new Date("2026-08-10T09:00:00Z"),
    clockOutAt: new Date("2026-08-10T17:00:00Z"),
    hourlyWage: 1200,
    ...overrides,
  };
}

test("複数スタッフを独立して給与集計する", () => {
  assert.deepEqual(
    summarizeMonthlyPayroll(
      [
        attendance(),
        attendance({
          userId: "staff-2",
          attendanceDate: "2026-08-11",
          clockInAt: new Date("2026-08-11T21:00:00Z"),
          clockOutAt: new Date("2026-08-12T03:00:00Z"),
        }),
      ],
      "2026-08",
    ),
    [
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 480,
        totalEstimatedPayYen: 9600,
      },
      {
        userId: "staff-2",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 360,
        totalEstimatedPayYen: 7200,
      },
    ],
  );
});

test("同日の複数勤怠をすべて給与へ反映する", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance(),
      attendance({
        clockInAt: new Date("2026-08-10T21:00:00Z"),
        clockOutAt: new Date("2026-08-11T03:00:00Z"),
      }),
    ],
    "2026-08",
  );

  assert.deepEqual(result[0], {
    userId: "staff-1",
    incompleteCount: 0,
    missingHourlyWageCount: 0,
    hasWorkingAttendance: false,
    otherIncompleteCount: 0,
    totalWorkedMinutes: 840,
    totalEstimatedPayYen: 16800,
  });
});

test("同日の複数勤怠は全件給与へ反映する", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({
        clockInAt: new Date("2026-08-10T09:00:00Z"),
        clockOutAt: new Date("2026-08-10T12:00:00Z"),
        hourlyWage: 1200,
      }),
      attendance({
        clockInAt: new Date("2026-08-10T13:00:00Z"),
        clockOutAt: new Date("2026-08-10T17:00:00Z"),
        hourlyWage: 1500,
      }),
    ],
    "2026-08",
  );

  assert.deepEqual(result[0], {
    userId: "staff-1",
    incompleteCount: 0,
    missingHourlyWageCount: 0,
    hasWorkingAttendance: false,
    otherIncompleteCount: 0,
    totalWorkedMinutes: 420,
    totalEstimatedPayYen: 9600,
  });
});

test("対象月はattendanceDate基準で判定する", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({
        attendanceDate: "2026-05-01",
      }),
      attendance({
        attendanceDate: "2026-05-01",
      }),
      attendance({
        attendanceDate: "2026-06-01",
      }),
    ],
    "2026-05",
  );

  assert.equal(result[0]?.totalEstimatedPayYen, 19200);
  assert.equal(result[0]?.totalWorkedMinutes, 960);
});

test("不完全な勤怠は給与に含めず不完全件数だけを増やす", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({ clockOutAt: null }),
      attendance({
        attendanceDate: "2026-08-20",
        clockInAt: new Date("invalid"),
      }),
    ],
    "2026-08",
  );

  assert.deepEqual(result[0], {
    userId: "staff-1",
    incompleteCount: 2,
    missingHourlyWageCount: 0,
    hasWorkingAttendance: true,
    otherIncompleteCount: 1,
    totalWorkedMinutes: 0,
    totalEstimatedPayYen: 0,
  });
});

test("合計給与を月単位で四捨五入する", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({
        clockInAt: new Date("2026-08-10T09:00:00Z"),
        clockOutAt: new Date("2026-08-10T09:01:00Z"),
        hourlyWage: 4200029,
      }),
      attendance({
        clockInAt: new Date("2026-08-11T09:00:00Z"),
        clockOutAt: new Date("2026-08-11T09:01:00Z"),
        hourlyWage: 1,
      }),
    ],
    "2026-08",
  );

  assert.equal(result[0]?.totalEstimatedPayYen, 70001);
});

test("0.5円未満は切り捨て、0.5円以上は切り上げる", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({
        clockInAt: new Date("2026-08-10T09:00:00Z"),
        clockOutAt: new Date("2026-08-10T09:01:00Z"),
        hourlyWage: 29,
      }),
      attendance({
        attendanceDate: "2026-08-11",
        clockInAt: new Date("2026-08-11T09:00:00Z"),
        clockOutAt: new Date("2026-08-11T09:01:00Z"),
        hourlyWage: 30,
      }),
    ],
    "2026-08",
  );

  assert.equal(result[0]?.totalEstimatedPayYen, 1);
});

test("不完全な勤怠と時給未設定の勤怠は給与に含めない", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({ clockOutAt: null }),
      attendance({ attendanceDate: "2026-08-11", hourlyWage: null }),
    ],
    "2026-08",
  );

  assert.deepEqual(result[0], {
    userId: "staff-1",
    incompleteCount: 1,
    missingHourlyWageCount: 1,
    hasWorkingAttendance: true,
    otherIncompleteCount: 0,
    totalWorkedMinutes: 480,
    totalEstimatedPayYen: 0,
  });
});

test("正常勤怠の時給未設定は状態件数に含め、給与には含めない", () => {
  const result = summarizeMonthlyPayroll(
    [attendance({ hourlyWage: null })],
    "2026-08",
  );

  assert.deepEqual(result[0], {
    userId: "staff-1",
    incompleteCount: 0,
    missingHourlyWageCount: 1,
    hasWorkingAttendance: false,
    otherIncompleteCount: 0,
    totalWorkedMinutes: 480,
    totalEstimatedPayYen: 0,
  });
});

test("勤務中勤怠だけでは要確認用の不完全件数を増やさない", () => {
  const result = summarizeMonthlyPayroll(
    [attendance({ clockOutAt: null })],
    "2026-08",
  );

  assert.equal(result[0]?.hasWorkingAttendance, true);
  assert.equal(result[0]?.incompleteCount, 1);
  assert.equal(result[0]?.otherIncompleteCount, 0);
});

test("勤務中勤怠とそれ以外の不完全勤怠を区別する", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({ clockOutAt: null }),
      attendance({
        attendanceDate: "2026-08-11",
        clockInAt: new Date("invalid"),
        clockOutAt: null,
      }),
    ],
    "2026-08",
  );

  assert.equal(result[0]?.hasWorkingAttendance, true);
  assert.equal(result[0]?.incompleteCount, 2);
  assert.equal(result[0]?.otherIncompleteCount, 1);
});

test("不正な出勤日時と退勤未登録は勤務中にせず不完全へ加算する", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({
        clockInAt: new Date("invalid"),
        clockOutAt: null,
      }),
      attendance({
        attendanceDate: "2026-08-11",
        clockInAt: null,
        clockOutAt: null,
      }),
    ],
    "2026-08",
  );

  assert.equal(result[0]?.hasWorkingAttendance, false);
  assert.equal(result[0]?.incompleteCount, 2);
  assert.equal(result[0]?.otherIncompleteCount, 2);
});

test("出退勤日時が揃っていても不正な経過時間はその他の不完全へ加算する", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({
        clockInAt: new Date("2026-08-10T17:00:00Z"),
        clockOutAt: new Date("2026-08-10T09:00:00Z"),
      }),
    ],
    "2026-08",
  );

  assert.equal(result[0]?.hasWorkingAttendance, false);
  assert.equal(result[0]?.incompleteCount, 1);
  assert.equal(result[0]?.otherIncompleteCount, 1);
});

test("複数の勤務中勤怠は不完全総件数だけを増やす", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({ clockOutAt: null }),
      attendance({
        attendanceDate: "2026-08-11",
        clockInAt: new Date("2026-08-11T09:00:00Z"),
        clockOutAt: null,
      }),
    ],
    "2026-08",
  );

  assert.equal(result[0]?.hasWorkingAttendance, true);
  assert.equal(result[0]?.incompleteCount, 2);
  assert.equal(result[0]?.otherIncompleteCount, 0);
});

test("対象月外の勤怠は状態と集計へ含めない", () => {
  const result = summarizeMonthlyPayroll(
    [
      attendance({
        attendanceDate: "2026-07-31",
        clockOutAt: null,
      }),
      attendance({
        attendanceDate: "2026-08-01",
        clockInAt: new Date("2026-08-01T09:00:00Z"),
        clockOutAt: new Date("2026-08-01T17:00:00Z"),
      }),
    ],
    "2026-08",
  );

  assert.equal(result[0]?.hasWorkingAttendance, false);
  assert.equal(result[0]?.incompleteCount, 0);
  assert.equal(result[0]?.otherIncompleteCount, 0);
  assert.equal(result[0]?.totalWorkedMinutes, 480);
  assert.equal(result[0]?.totalEstimatedPayYen, 9600);
});

test("対象スタッフと勤務日の月に属する勤怠だけを勤怠別に算出する", () => {
  const inputs = [
    payrollAttendance({
      attendanceId: "day-1",
      hourlyWage: 1200,
      clockInAt: new Date("2026-08-10T09:00:00Z"),
      clockOutAt: new Date("2026-08-10T10:00:00Z"),
    }),
    payrollAttendance({
      attendanceId: "day-2",
      hourlyWage: 1500,
      clockInAt: new Date("2026-08-10T13:00:00Z"),
      clockOutAt: new Date("2026-08-10T13:30:00Z"),
    }),
    payrollAttendance({
      attendanceId: "night-1",
      workPeriod: "night",
      attendanceDate: "2026-08-31",
      clockInAt: new Date("2026-08-31T21:00:00Z"),
      clockOutAt: new Date("2026-09-01T03:00:00Z"),
    }),
    payrollAttendance({
      attendanceId: "other-user",
      userId: "staff-2",
    }),
    payrollAttendance({
      attendanceId: "other-month",
      attendanceDate: "2026-09-01",
    }),
  ];
  const result = calculateUserMonthlyPayrollDetail(
    inputs,
    "2026-08",
    "staff-1",
  );

  assert.equal(result.userId, "staff-1");
  assert.equal(result.month, "2026-08");
  assert.equal(result.attendances.length, 3);
  assert.deepEqual(
    result.attendances.map(
      ({
        attendanceId,
        workPeriod,
        workedMinutes,
        estimatedPayYen,
        status,
      }) => ({
        attendanceId,
        workPeriod,
        workedMinutes,
        estimatedPayYen,
        status,
      }),
    ),
    [
      {
        attendanceId: "day-1",
        workPeriod: "day",
        workedMinutes: 60,
        estimatedPayYen: 1200,
        status: "calculated",
      },
      {
        attendanceId: "day-2",
        workPeriod: "day",
        workedMinutes: 30,
        estimatedPayYen: 750,
        status: "calculated",
      },
      {
        attendanceId: "night-1",
        workPeriod: "night",
        workedMinutes: 360,
        estimatedPayYen: 7200,
        status: "calculated",
      },
    ],
  );
  assert.equal(result.totalEstimatedPayYen, 9150);
  assert.equal(result.uncomputedCount, 0);
  assert.equal(result.roundingAdjustmentYen, 0);
  assert.equal(
    summarizeMonthlyPayroll(inputs, "2026-08").find(
      (summary) => summary.userId === "staff-1",
    )?.totalEstimatedPayYen,
    result.totalEstimatedPayYen,
  );
});

test("時給未設定・時刻不備・退勤未登録を正常算出や相互に混同しない", () => {
  const result = calculateUserMonthlyPayrollDetail(
    [
      payrollAttendance({ attendanceId: "missing-wage", hourlyWage: null }),
      payrollAttendance({ attendanceId: "zero-wage", hourlyWage: 0 }),
      payrollAttendance({ attendanceId: "working", clockOutAt: null }),
      payrollAttendance({
        attendanceId: "invalid-clock-in",
        clockInAt: new Date("invalid"),
        clockOutAt: null,
      }),
      payrollAttendance({
        attendanceId: "invalid-clock-out",
        clockOutAt: new Date("invalid"),
      }),
      payrollAttendance({
        attendanceId: "reversed-time",
        clockInAt: new Date("2026-08-10T17:00:00Z"),
        clockOutAt: new Date("2026-08-10T09:00:00Z"),
      }),
    ],
    "2026-08",
    "staff-1",
  );

  assert.deepEqual(
    result.attendances.map(
      ({
        attendanceId,
        workedMinutes,
        estimatedPayYenTimes60,
        estimatedPayYen,
        status,
      }) => ({
        attendanceId,
        workedMinutes,
        estimatedPayYenTimes60,
        estimatedPayYen,
        status,
      }),
    ),
    [
      {
        attendanceId: "missing-wage",
        workedMinutes: 480,
        estimatedPayYenTimes60: null,
        estimatedPayYen: null,
        status: "missingHourlyWage",
      },
      {
        attendanceId: "zero-wage",
        workedMinutes: 480,
        estimatedPayYenTimes60: 0,
        estimatedPayYen: 0,
        status: "calculated",
      },
      {
        attendanceId: "working",
        workedMinutes: null,
        estimatedPayYenTimes60: null,
        estimatedPayYen: null,
        status: "clockOutMissing",
      },
      {
        attendanceId: "invalid-clock-in",
        workedMinutes: null,
        estimatedPayYenTimes60: null,
        estimatedPayYen: null,
        status: "incomplete",
      },
      {
        attendanceId: "invalid-clock-out",
        workedMinutes: null,
        estimatedPayYenTimes60: null,
        estimatedPayYen: null,
        status: "incomplete",
      },
      {
        attendanceId: "reversed-time",
        workedMinutes: null,
        estimatedPayYenTimes60: null,
        estimatedPayYen: null,
        status: "incomplete",
      },
    ],
  );
  assert.equal(result.uncomputedCount, 5);
  assert.equal(result.totalEstimatedPayYen, 0);
});

test("正式な月次合計と勤怠別表示金額の差額を正負ともに保持する", () => {
  const positive = calculateUserMonthlyPayrollDetail(
    [
      payrollAttendance({
        attendanceId: "positive-1",
        clockInAt: new Date("2026-08-10T09:00:00Z"),
        clockOutAt: new Date("2026-08-10T09:01:00Z"),
        hourlyWage: 29,
      }),
      payrollAttendance({
        attendanceId: "positive-2",
        clockInAt: new Date("2026-08-11T09:00:00Z"),
        clockOutAt: new Date("2026-08-11T09:01:00Z"),
        hourlyWage: 29,
      }),
    ],
    "2026-08",
    "staff-1",
  );
  assert.equal(positive.totalEstimatedPayYen, 1);
  assert.equal(positive.roundingAdjustmentYen, 1);
  assert.equal(
    positive.attendances.reduce(
      (total, detail) => total + (detail.estimatedPayYen ?? 0),
      0,
    ) + positive.roundingAdjustmentYen,
    positive.totalEstimatedPayYen,
  );

  const negative = calculateUserMonthlyPayrollDetail(
    [
      payrollAttendance({
        attendanceId: "negative-1",
        clockInAt: new Date("2026-08-10T09:00:00Z"),
        clockOutAt: new Date("2026-08-10T09:01:00Z"),
        hourlyWage: 30,
      }),
      payrollAttendance({
        attendanceId: "negative-2",
        clockInAt: new Date("2026-08-11T09:00:00Z"),
        clockOutAt: new Date("2026-08-11T09:01:00Z"),
        hourlyWage: 30,
      }),
    ],
    "2026-08",
    "staff-1",
  );
  assert.equal(negative.totalEstimatedPayYen, 1);
  assert.equal(negative.roundingAdjustmentYen, -1);
  assert.equal(
    negative.attendances.reduce(
      (total, detail) => total + (detail.estimatedPayYen ?? 0),
      0,
    ) + negative.roundingAdjustmentYen,
    negative.totalEstimatedPayYen,
  );
});

test("対象勤怠が0件なら空の詳細と0円を返す", () => {
  assert.deepEqual(
    calculateUserMonthlyPayrollDetail([], "2026-08", "staff-1"),
    {
      userId: "staff-1",
      month: "2026-08",
      totalEstimatedPayYen: 0,
      uncomputedCount: 0,
      roundingAdjustmentYen: 0,
      attendances: [],
    },
  );
});

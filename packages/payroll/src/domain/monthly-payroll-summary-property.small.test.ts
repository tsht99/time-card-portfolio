import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  type MonthlyPayrollAttendance,
  summarizeMonthlyPayroll,
} from "./monthly-payroll-summary.ts";

const yearMonth = "2026-08";

type GeneratedAttendance = MonthlyPayrollAttendance & {
  hourlyWage: number;
  workedMinutes: number;
};

const attendanceArbitrary = fc
  .record({
    dayOfMonth: fc.integer({ min: 1, max: 31 }),
    workedMinutes: fc.integer({ min: 0, max: 24 * 60 }),
    hourlyWage: fc.integer({ min: 0, max: 10_000 }),
  })
  .map(({ dayOfMonth, workedMinutes, hourlyWage }): GeneratedAttendance => {
    const clockInAt = new Date(
      `${yearMonth}-${String(dayOfMonth).padStart(2, "0")}T00:00:00.000Z`,
    );
    const clockOutAt = new Date(clockInAt.getTime() + workedMinutes * 60_000);

    return {
      userId: "user-property-test",
      attendanceDate: `${yearMonth}-${String(dayOfMonth).padStart(2, "0")}`,
      clockInAt,
      clockOutAt,
      hourlyWage,
      workedMinutes,
    };
  });

const attendancesArbitrary = fc.array(attendanceArbitrary, {
  minLength: 1,
  maxLength: 31,
});

function estimatedPayFor(
  attendances: readonly GeneratedAttendance[],
  predicate: (attendance: GeneratedAttendance) => boolean,
): number {
  return Math.round(
    attendances.reduce(
      (total, attendance) =>
        predicate(attendance)
          ? total + attendance.workedMinutes * attendance.hourlyWage
          : total,
      0,
    ) / 60,
  );
}

test("月内の分給相当額を合計してから最後に一度だけ給与を丸める", () => {
  fc.assert(
    fc.property(attendancesArbitrary, (attendances) => {
      const [summary] = summarizeMonthlyPayroll(attendances, yearMonth);
      assert.ok(summary !== undefined);

      assert.equal(
        summary.totalEstimatedPayYen,
        estimatedPayFor(attendances, () => true),
      );
      assert.equal(
        summary.totalWorkedMinutes,
        attendances.reduce(
          (total, attendance) => total + attendance.workedMinutes,
          0,
        ),
      );
      assert.equal(summary.hasWorkingAttendance, false);
      assert.equal(summary.otherIncompleteCount, 0);
    }),
  );
});

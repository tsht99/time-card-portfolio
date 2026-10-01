import assert from "node:assert/strict";
import test from "node:test";
import type { HourlyWageRate } from "../domain/hourly-wage-rate.ts";
import {
  createAttendancePayrollApplication,
  PayrollTargetUserNotFoundError,
} from "./attendance-payroll.ts";

const hourlyWageRate: HourlyWageRate = {
  userId: "user-1",
  workPeriod: "day",
  dayType: "fri",
  hourlyWage: 1200,
  effectiveFrom: "2026-01-01",
};

function attendanceDetail(overrides: Record<string, unknown> = {}) {
  return {
    attendanceId: "attendance-1",
    attendanceDate: "2026-05-01",
    userId: "user-1",
    workPeriod: "day" as const,
    clockInAt: "2026-05-01T09:00:00.000Z",
    clockOutAt: "2026-05-01T18:00:00.000Z",
    status: "completed",
    ...overrides,
  };
}

test("Attendance detail payroll is calculated by the existing Payroll application", async () => {
  let detailReads = 0;
  let rateReads = 0;
  const application = createAttendancePayrollApplication({
    attendance: {
      async getCurrentStates() {
        return [];
      },
      async getAdminAttendanceDetail() {
        detailReads += 1;
        return attendanceDetail();
      },
    },
    hourlyWageRateStore: {
      async findAll() {
        rateReads += 1;
        return [hourlyWageRate];
      },
    },
    userReferences: {
      async getUserById() {
        return null;
      },
    },
  });

  assert.deepEqual(
    await application.getAttendancePayrollEstimate("attendance-1"),
    {
      hourlyWage: 1200,
      estimatedPayYen: 10800,
      status: "calculated",
    },
  );
  assert.equal(detailReads, 1);
  assert.equal(rateReads, 1);
});

test("cancelled attendance remains excluded from Payroll", async () => {
  let rateReads = 0;
  const application = createAttendancePayrollApplication({
    attendance: {
      async getCurrentStates() {
        return [];
      },
      async getAdminAttendanceDetail() {
        return attendanceDetail({ status: "cancelled" });
      },
    },
    hourlyWageRateStore: {
      async findAll() {
        rateReads += 1;
        return [hourlyWageRate];
      },
    },
    userReferences: {
      async getUserById() {
        return null;
      },
    },
  });

  assert.deepEqual(
    await application.getAttendancePayrollEstimate("attendance-1"),
    {
      hourlyWage: null,
      estimatedPayYen: null,
      status: "excluded",
    },
  );
  assert.equal(rateReads, 0);
});

test("月次詳細は対象利用者を1件取得し displayName を返す", async () => {
  const lookups: string[] = [];
  const application = createAttendancePayrollApplication({
    attendance: {
      async getCurrentStates() {
        return [];
      },
      async getAdminAttendanceDetail() {
        return attendanceDetail();
      },
    },
    hourlyWageRateStore: {
      async findAll() {
        return [];
      },
    },
    userReferences: {
      async getUserById(userId) {
        lookups.push(userId);
        return { userId, role: "staff", displayName: "給与対象者" };
      },
    },
  });

  const detail = await application.getUserMonthlyPayrollDetail(
    "user-1",
    "2026-05",
  );
  assert.equal(detail.displayName, "給与対象者");
  assert.deepEqual(lookups, ["user-1"]);
});

test("月次詳細は対象利用者がいない場合に既存の not-found error を返す", async () => {
  const application = createAttendancePayrollApplication({
    attendance: {
      async getCurrentStates() {
        return [];
      },
      async getAdminAttendanceDetail() {
        return attendanceDetail();
      },
    },
    hourlyWageRateStore: {
      async findAll() {
        return [];
      },
    },
    userReferences: {
      async getUserById() {
        return null;
      },
    },
  });

  await assert.rejects(
    application.getUserMonthlyPayrollDetail("missing-user", "2026-05"),
    PayrollTargetUserNotFoundError,
  );
});

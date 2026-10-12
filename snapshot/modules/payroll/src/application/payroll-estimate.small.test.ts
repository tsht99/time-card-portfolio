import assert from "node:assert/strict";
import test from "node:test";
import type { HourlyWageRule } from "../domain/hourly-wage-rule.ts";
import {
  createPayrollEstimateApplication as createPayrollEstimateApplicationImpl,
  PayrollEstimateTargetUserNotFoundError,
} from "./payroll-estimate.ts";
import type { HourlyWageRuleReadStore } from "./ports/hourly-wage-rule-ports.ts";
import type { PayrollEstimateAttendanceQueryPort } from "./ports/payroll-estimate-attendance-query.ts";
import type { PayrollUserReferenceReader } from "./ports/user-reference.ts";

const actorId = "test-admin";
function createPayrollEstimateApplication(input: {
  attendance: PayrollEstimateAttendanceQueryPort;
  hourlyWageRuleStore: HourlyWageRuleReadStore;
  userReferences: PayrollUserReferenceReader;
  actorStatus?: string;
  actorRole?: string;
}) {
  return createPayrollEstimateApplicationImpl({
    attendance: input.attendance,
    unitOfWork: {
      async run(operation) {
        return operation({
          users: {
            async getUserById(userId) {
              if (userId === actorId)
                return {
                  userId,
                  role: input.actorRole ?? "admin",
                  status: input.actorStatus ?? "active",
                  displayName: "管理者",
                };
              return input.userReferences.getUserById(userId);
            },
            async getUsers() {
              return [];
            },
          },
          hourlyWageRuleReadStore: input.hourlyWageRuleStore,
          hourlyWageRuleManagementPersistence: {
            async findAllForUser() {
              return [];
            },
            async create() {
              throw new Error("unused");
            },
            async update() {
              throw new Error("unused");
            },
            async delete() {
              throw new Error("unused");
            },
            async bulkUpdate() {
              throw new Error("unused");
            },
          },
        });
      },
    },
  });
}

test("non-admins receive the same denial for existing and missing payroll targets", async () => {
  for (const actor of [
    { actorRole: "staff", actorStatus: "active" },
    { actorRole: "admin", actorStatus: "inactive" },
    { actorRole: "unknown", actorStatus: "active" },
  ]) {
    for (const targetUserId of ["user-1", "missing-user"]) {
      let targetLookups = 0;
      const application = createPayrollEstimateApplication({
        ...actor,
        attendance: {
          async getPayrollProjectionStates() {
            return [];
          },
        },
        hourlyWageRuleStore: {
          async findForPayrollEstimate() {
            throw new Error("must not read payroll data");
          },
        },
        userReferences: {
          async getUserById(userId) {
            targetLookups += 1;
            return userId === "missing-user"
              ? null
              : { userId, role: "staff", status: "active", displayName: null };
          },
        },
      });
      const outcomes = await Promise.all([
        application
          .getUserMonthlyPayrollEstimateDetail(actorId, targetUserId, "2026-05")
          .then(
            () => "success",
            (error: unknown) => (error as Error).name,
          ),
        application
          .getAttendancePayrollEstimate(
            actorId,
            payrollSnapshot({ userId: targetUserId }),
          )
          .then(
            () => "success",
            (error: unknown) => (error as Error).name,
          ),
      ]);
      assert.deepEqual(outcomes, [
        "PayrollEstimateForbiddenError",
        "PayrollEstimateForbiddenError",
      ]);
      assert.equal(targetLookups, 0);
    }
  }
});

test("active admins receive target-not-found for missing payroll targets", async () => {
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate() {
        throw new Error("must not read payroll data for a missing target");
      },
    },
    userReferences: {
      async getUserById() {
        return null;
      },
    },
  });

  await assert.rejects(
    application.getUserMonthlyPayrollEstimateDetail(
      actorId,
      "missing-user",
      "2026-05",
    ),
    { name: "PayrollEstimateTargetUserNotFoundError" },
  );
  await assert.rejects(
    application.getAttendancePayrollEstimate(
      actorId,
      payrollSnapshot({ userId: "missing-user" }),
    ),
    { name: "PayrollEstimateTargetUserNotFoundError" },
  );
});

test("Payroll estimate Application rechecks active-admin state and rejects without reading wage data", async () => {
  let wageReads = 0;
  let attendanceReads = 0;
  const application = createPayrollEstimateApplication({
    actorStatus: "inactive",
    attendance: {
      async getPayrollProjectionStates() {
        attendanceReads += 1;
        return [];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate() {
        wageReads += 1;
        return [];
      },
    },
    userReferences: {
      async getUserById(userId) {
        return { userId, role: "staff", status: "active", displayName: null };
      },
    },
  });
  await assert.rejects(
    application.getUserMonthlyPayrollEstimateDetail(
      actorId,
      "user-1",
      "2026-05",
    ),
    { name: "PayrollEstimateForbiddenError" },
  );
  await assert.rejects(
    application.getMonthlyPayrollEstimateSummary(actorId, "2026-05"),
    { name: "PayrollEstimateForbiddenError" },
  );
  assert.equal(wageReads, 0);
  assert.equal(attendanceReads, 0);
});

test("active admin can read payroll estimates for another admin", async () => {
  const otherAdminId = "other-admin";
  const state = payrollSnapshot({ userId: otherAdminId });
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [state];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate() {
        return [{ ...hourlyWageRule, userId: otherAdminId }];
      },
    },
    userReferences: {
      async getUserById(userId) {
        if (userId === otherAdminId)
          return {
            userId,
            role: "admin",
            status: "inactive",
            displayName: "別の管理者",
          };
        return null;
      },
    },
  });

  const detail = await application.getUserMonthlyPayrollEstimateDetail(
    actorId,
    otherAdminId,
    "2026-05",
  );
  assert.equal(detail.displayName, "別の管理者");
  assert.equal(detail.attendances.length, 1);

  const attendanceEstimate = await application.getAttendancePayrollEstimate(
    actorId,
    state,
  );
  assert.equal(attendanceEstimate.status, "calculated");

  const summary = await application.getMonthlyPayrollEstimateSummary(
    actorId,
    "2026-05",
  );
  assert.deepEqual(
    summary.summaries.map((item) => item.userId),
    [otherAdminId],
  );
});

const hourlyWageRule: HourlyWageRule = {
  userId: "user-1",
  workPeriod: "day",
  dayType: "fri",
  hourlyWage: 1200,
  effectiveFrom: "2026-01-01",
};

function payrollSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    attendanceId: "attendance-1",
    userId: "user-1",
    attendanceDate: "2026-05-01",
    workPeriod: "day" as const,
    clockInAt: new Date("2026-05-01T09:00:00.000Z"),
    clockOutAt: new Date("2026-05-01T18:00:00.000Z"),
    cancelled: false,
    ...overrides,
  };
}

test("Attendance detail payroll estimate is calculated by the Payroll Estimate application", async () => {
  let rulesReads = 0;
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate(query) {
        rulesReads += 1;
        assert.deepEqual(query, {
          userIds: ["user-1"],
          startAttendanceDateInclusive: "2026-05-01",
          endAttendanceDateInclusive: "2026-05-01",
        });
        return [hourlyWageRule];
      },
    },
    userReferences: {
      async getUserById(userId) {
        return {
          userId,
          role: "staff",
          status: "active",
          displayName: "スタッフ",
        };
      },
    },
  });

  assert.deepEqual(
    await application.getAttendancePayrollEstimate(actorId, payrollSnapshot()),
    {
      hourlyWage: 1200,
      estimatedPayYen: 10800,
      status: "calculated",
    },
  );
  assert.equal(rulesReads, 1);
});

test("cancelled attendance remains excluded from payroll estimate", async () => {
  let rulesReads = 0;
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate() {
        rulesReads += 1;
        return [hourlyWageRule];
      },
    },
    userReferences: {
      async getUserById(userId) {
        return {
          userId,
          role: "staff",
          status: "active",
          displayName: "スタッフ",
        };
      },
    },
  });

  assert.deepEqual(
    await application.getAttendancePayrollEstimate(
      actorId,
      payrollSnapshot({ cancelled: true }),
    ),
    {
      hourlyWage: null,
      estimatedPayYen: null,
      status: "excluded",
    },
  );
  assert.equal(rulesReads, 0);
});

test("single attendance estimate preserves incomplete, missing-wage, and monthly calculation results", async () => {
  const complete = payrollSnapshot();
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [complete];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate() {
        return [hourlyWageRule];
      },
    },
    userReferences: {
      async getUserById(userId) {
        return {
          userId,
          role: "staff",
          status: "active",
          displayName: "スタッフ",
        };
      },
    },
  });
  const missingCheckout = payrollSnapshot({ clockOutAt: null });
  const noWage = payrollSnapshot({ workPeriod: "night" });
  const monthly = await application.getUserMonthlyPayrollEstimateDetail(
    actorId,
    "user-1",
    "2026-05",
  );
  const single = await application.getAttendancePayrollEstimate(
    actorId,
    complete,
  );

  assert.deepEqual(
    await application.getAttendancePayrollEstimate(actorId, missingCheckout),
    {
      hourlyWage: 1200,
      estimatedPayYen: null,
      status: "clockOutMissing",
    },
  );
  assert.deepEqual(
    await application.getAttendancePayrollEstimate(actorId, noWage),
    {
      hourlyWage: null,
      estimatedPayYen: null,
      status: "missingHourlyWage",
    },
  );
  assert.deepEqual(single, {
    hourlyWage: monthly.attendances[0]?.hourlyWage,
    estimatedPayYen: monthly.attendances[0]?.estimatedPayYen,
    status: monthly.attendances[0]?.status,
  });
});

test("月次詳細は対象利用者を1件取得し displayName を返す", async () => {
  const lookups: string[] = [];
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate(query) {
        assert.deepEqual(query, {
          userIds: ["user-1"],
          startAttendanceDateInclusive: "2026-05-01",
          endAttendanceDateInclusive: "2026-05-31",
        });
        return [];
      },
    },
    userReferences: {
      async getUserById(userId) {
        lookups.push(userId);
        return {
          userId,
          role: "staff",
          status: "active",
          displayName: "給与対象者",
        };
      },
    },
  });

  const detail = await application.getUserMonthlyPayrollEstimateDetail(
    actorId,
    "user-1",
    "2026-05",
  );
  assert.equal(detail.displayName, "給与対象者");
  assert.deepEqual(lookups, ["user-1"]);
});

test("月次詳細の Application read model は勤怠時刻を Date|null のまま返す", async () => {
  const clockInAt = new Date("2026-05-01T09:00:00.000Z");
  const clockOutAt = new Date("2026-05-01T18:00:00.000Z");
  const invalidDate = new Date(Number.NaN);
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [
          {
            attendanceId: "attendance-1",
            userId: "user-1",
            attendanceDate: "2026-05-01",
            workPeriod: "day" as const,
            clockInAt,
            clockOutAt,
          },
          {
            attendanceId: "attendance-2",
            userId: "user-1",
            attendanceDate: "2026-05-02",
            workPeriod: "night" as const,
            clockInAt: invalidDate,
            clockOutAt: null,
          },
        ];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate() {
        return [];
      },
    },
    userReferences: {
      async getUserById(userId) {
        return {
          userId,
          role: "staff",
          status: "active",
          displayName: "給与対象者",
        };
      },
    },
  });

  const detail = await application.getUserMonthlyPayrollEstimateDetail(
    actorId,
    "user-1",
    "2026-05",
  );
  assert.equal(detail.displayName, "給与対象者");
  assert.equal(detail.attendances[0]?.clockInAt, clockInAt);
  assert.equal(detail.attendances[0]?.clockOutAt, clockOutAt);
  assert.equal(detail.attendances[1]?.clockInAt, invalidDate);
  assert.equal(detail.attendances[1]?.clockOutAt, null);
});

test("月次詳細は対象利用者がいない場合に既存の not-found error を返す", async () => {
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate() {
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
    application.getUserMonthlyPayrollEstimateDetail(
      actorId,
      "missing-user",
      "2026-05",
    ),
    PayrollEstimateTargetUserNotFoundError,
  );
  await assert.rejects(
    application.getAttendancePayrollEstimate(
      actorId,
      payrollSnapshot({ userId: "missing-user" }),
    ),
    PayrollEstimateTargetUserNotFoundError,
  );
});

test("monthly summary queries only attendance users and skips wage lookup when empty", async () => {
  let states: Array<{
    attendanceId: string;
    userId: string;
    attendanceDate: string;
    workPeriod: "day" | "night";
    clockInAt: Date | null;
    clockOutAt: Date | null;
  }> = [];
  const queries: unknown[] = [];
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return states;
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate(query) {
        queries.push(query);
        return [];
      },
    },
    userReferences: {
      async getUserById(userId) {
        return {
          userId,
          role: "staff",
          status: "active",
          displayName: "スタッフ",
        };
      },
    },
  });
  await application.getMonthlyPayrollEstimateSummary(actorId, "2026-05");
  assert.deepEqual(queries, []);
  states = [
    {
      attendanceId: "a1",
      userId: "user-1",
      attendanceDate: "2026-05-02",
      workPeriod: "day",
      clockInAt: null,
      clockOutAt: null,
    },
    {
      attendanceId: "a2",
      userId: "user-1",
      attendanceDate: "2026-05-03",
      workPeriod: "night",
      clockInAt: null,
      clockOutAt: null,
    },
    {
      attendanceId: "a3",
      userId: "user-2",
      attendanceDate: "2026-05-03",
      workPeriod: "day",
      clockInAt: null,
      clockOutAt: null,
    },
  ];
  await application.getMonthlyPayrollEstimateSummary(actorId, "2026-05");
  assert.deepEqual(queries, [
    {
      userIds: ["user-1", "user-2"],
      startAttendanceDateInclusive: "2026-05-01",
      endAttendanceDateInclusive: "2026-05-31",
    },
  ]);
});

test("attendance estimate queries only its user and attendance date", async () => {
  let query: unknown;
  const application = createPayrollEstimateApplication({
    attendance: {
      async getPayrollProjectionStates() {
        return [];
      },
    },
    hourlyWageRuleStore: {
      async findForPayrollEstimate(value) {
        query = value;
        return [hourlyWageRule];
      },
    },
    userReferences: {
      async getUserById(userId) {
        return {
          userId,
          role: "staff",
          status: "active",
          displayName: "スタッフ",
        };
      },
    },
  });
  await application.getAttendancePayrollEstimate(
    actorId,
    payrollSnapshot({ attendanceDate: "2026-05-14" }),
  );
  assert.deepEqual(query, {
    userIds: ["user-1"],
    startAttendanceDateInclusive: "2026-05-14",
    endAttendanceDateInclusive: "2026-05-14",
  });
});

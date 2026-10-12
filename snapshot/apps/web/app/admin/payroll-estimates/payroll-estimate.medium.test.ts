// cspell:ignore networkidle
import { randomUUID } from "node:crypto";

import {
  attendanceCurrentStates,
  attendanceEvents,
  hourlyWageRules,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";
import { testTokyoDateAt } from "web/test-support/browser/reference-time";

const TEST_MONTH = "2026-01";

function attendanceDateAt(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(date);
}

async function createAttendance(
  staff: Awaited<ReturnType<typeof createAuthenticatedUser>>,
  {
    clockInAt,
    clockOutAt,
    workPeriod,
  }: {
    clockInAt: Date;
    clockOutAt: Date | null;
    workPeriod: "day" | "night";
  },
) {
  const attendanceId = randomUUID();
  const attendanceDate = attendanceDateAt(clockInAt);
  const events: (typeof attendanceEvents.$inferInsert)[] = [
    {
      attendanceId,
      performedByUserId: staff.userId,
      eventVersion: 1,
      eventType: "AttendanceClockedIn",
      payload: {
        userId: staff.userId,
        workPeriod,
        attendanceDate,
        clockInAt: clockInAt.toISOString(),
      },
    },
  ];
  if (clockOutAt !== null) {
    events.push({
      attendanceId,
      performedByUserId: staff.userId,
      eventVersion: 2,
      eventType: "AttendanceClockedOut",
      payload: { clockOutAt: clockOutAt.toISOString() },
    });
  }

  await staff.db.transaction(async (tx) => {
    await tx.insert(attendanceEvents).values(events);
    await tx.insert(attendanceCurrentStates).values({
      attendanceId,
      userId: staff.userId,
      attendanceDate,
      workPeriod,
      clockInAt,
      clockOutAt,
      eventVersion: clockOutAt === null ? 1 : 2,
    });
  });

  return { attendanceDate, attendanceId };
}

test("給与見込み一覧から給与見込み詳細へ遷移し、対象月を保持して戻れる", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E月次給与見込み-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  let hourlyWageRuleId: string | undefined;
  try {
    const dayClockInAt = testTokyoDateAt(0, "09:00");
    const dayClockOutAt = testTokyoDateAt(0, "18:00");
    const nightClockInAt = testTokyoDateAt(0, "20:00");
    const dayAttendance = await createAttendance(staff, {
      clockInAt: dayClockInAt,
      clockOutAt: dayClockOutAt,
      workPeriod: "day",
    });
    await createAttendance(staff, {
      clockInAt: nightClockInAt,
      clockOutAt: null,
      workPeriod: "night",
    });
    const [hourlyWageRule] = await staff.db
      .insert(hourlyWageRules)
      .values({
        userId: staff.userId,
        workPeriod: "day",
        dayType: "holiday",
        hourlyWage: 1200,
        effectiveFrom: dayAttendance.attendanceDate,
      })
      .returning({ id: hourlyWageRules.id });
    hourlyWageRuleId = hourlyWageRule?.id;

    await page.goto(`/admin/payroll-estimates?month=${TEST_MONTH}`);
    const summaryList = page.getByRole("list", { name: "給与見込み一覧" });
    const summaryRow = summaryList
      .getByRole("listitem")
      .filter({ hasText: displayName });
    await expect(summaryRow).toHaveCount(1);
    await expect(summaryRow).toContainText("10,800円");
    await expect(summaryRow).toContainText("要確認");
    await expect(summaryRow).not.toContainText("退勤未記録");
    await expect(summaryRow).not.toContainText("勤務中");
    const monthNavigation = page.getByRole("group", {
      name: "給与見込み一覧の月ナビゲーション",
    });
    await monthNavigation.getByRole("button", { name: "前の月" }).click();
    await expect(page).toHaveURL("/admin/payroll-estimates?month=2025-12");
    await monthNavigation.getByRole("button", { name: "次の月" }).click();
    await expect(page).toHaveURL(
      `/admin/payroll-estimates?month=${TEST_MONTH}`,
    );

    const detailLink = summaryRow.getByRole("link", {
      name: `${displayName}、給与見込み 10,800円、要確認、給与見込み詳細へ移動`,
    });
    await detailLink.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/admin/users/${staff.userId}/payroll-estimates\\?month=${TEST_MONTH}$`,
      ),
    );
    await expect(
      page
        .getByRole("region", { name: "対象ユーザー" })
        .getByText(displayName, { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "2026年1月", exact: true }),
    ).toBeVisible();
    const detailList = page.getByRole("list", { name: "勤怠別給与見込み明細" });
    await expect(detailList.locator("li")).toHaveCount(2);
    await expect(detailList).toContainText("昼");
    await expect(detailList).toContainText("夜");
    await expect(detailList).toContainText("1,200円/時");
    await expect(detailList).toContainText("10,800円");
    await expect(detailList).toContainText("退勤未記録");
    await expect(page.getByText("未算出 1件")).toBeVisible();

    await detailList.getByRole("link").filter({ hasText: "10,800円" }).click();
    await expect(page).toHaveURL(
      `/admin/attendance/${dayAttendance.attendanceId}`,
    );
    const attendanceSummary = page.getByRole("region", {
      name: "勤怠の現在状態",
    });
    await expect(attendanceSummary).toContainText("1,200円/時");
    await expect(attendanceSummary).toContainText("10,800円");
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(
        `/admin/users/${staff.userId}/payroll-estimates\\?month=${TEST_MONTH}$`,
      ),
    );
    await expect(detailList).toBeVisible();

    await page.reload();
    if (process.env.WEB_TEST_RUNTIME === "development") {
      await page.waitForLoadState("networkidle");
    }
    await expect(
      page
        .getByRole("region", { name: "対象ユーザー" })
        .getByText(displayName, { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "2026年1月", exact: true }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(
      `/admin/payroll-estimates?month=${TEST_MONTH}`,
    );
    await expect(
      page.getByRole("list", { name: "給与見込み一覧" }),
    ).toBeVisible();

    await detailLink.click();
    await expect(page).toHaveURL(
      `/admin/users/${staff.userId}/payroll-estimates?month=${TEST_MONTH}`,
    );
    const detailMonthNavigation = page.getByRole("group", {
      name: "給与見込み詳細の月ナビゲーション",
    });
    await detailMonthNavigation.getByRole("button", { name: "前の月" }).click();
    await expect(page).toHaveURL(
      `/admin/users/${staff.userId}/payroll-estimates?month=2025-12`,
    );
    await expect(
      page.getByRole("heading", { name: "2025年12月", exact: true }),
    ).toBeVisible();
    await detailMonthNavigation.getByRole("button", { name: "次の月" }).click();
    await expect(page).toHaveURL(
      `/admin/users/${staff.userId}/payroll-estimates?month=${TEST_MONTH}`,
    );
  } finally {
    if (hourlyWageRuleId) {
      await staff.db
        .delete(hourlyWageRules)
        .where(eq(hourlyWageRules.id, hourlyWageRuleId));
    }
    await staff.cleanup();
  }
});

test("勤怠詳細から勤怠日時点の時給設定を開き、reload後も基準日を維持する", async ({
  page,
  admin,
}) => {
  void admin;
  const displayName = `E2E時給基準日-${randomUUID()}`;
  const staff = await createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
  const hourlyWageRuleIds: string[] = [];
  try {
    const attendance = await createAttendance(staff, {
      clockInAt: testTokyoDateAt(-1, "09:00"),
      clockOutAt: testTokyoDateAt(-1, "18:00"),
      workPeriod: "day",
    });
    const dayType = "wed";
    const inserted = await staff.db
      .insert(hourlyWageRules)
      .values([
        {
          userId: staff.userId,
          workPeriod: "day",
          dayType,
          hourlyWage: 1200,
          effectiveFrom: attendance.attendanceDate,
        },
        {
          userId: staff.userId,
          workPeriod: "day",
          dayType,
          hourlyWage: 1500,
          effectiveFrom: "2026-01-01",
        },
      ])
      .returning({ id: hourlyWageRules.id });
    hourlyWageRuleIds.push(...inserted.map((row) => row.id));

    await page.goto(`/admin/attendance/${attendance.attendanceId}`);
    const attendanceSummary = page.getByRole("region", {
      name: "勤怠の現在状態",
    });
    await expect(attendanceSummary).toBeVisible({ timeout: 15000 });
    const settingsLink = attendanceSummary.getByRole("link", {
      name: "時給設定を確認",
    });
    await expect(settingsLink).toHaveAttribute(
      "href",
      `/admin/users/${staff.userId}/hourly-wage-rules?date=${attendance.attendanceDate}`,
    );
    await settingsLink.click();
    await expect(page).toHaveURL(
      `/admin/users/${staff.userId}/hourly-wage-rules?date=${attendance.attendanceDate}`,
    );
    await expect(
      page.getByRole("region", { name: "対象ユーザー" }),
    ).toContainText(displayName);
    await expect(
      page.getByRole("combobox", { name: "時給の適用期間" }),
    ).toContainText("2025/12/31時点");
    const targetRow = page.getByRole("row", {
      name: new RegExp(
        {
          sun: "日",
          mon: "月",
          tue: "火",
          wed: "水",
          thu: "木",
          fri: "金",
          sat: "土",
          holiday: "祝日",
        }[dayType],
      ),
    });
    await expect(targetRow).toContainText("1,200円");
    await expect(targetRow).not.toContainText("1,500円");
    await page.reload();
    await expect(page).toHaveURL(
      `/admin/users/${staff.userId}/hourly-wage-rules?date=${attendance.attendanceDate}`,
    );
    await expect(
      page.getByRole("combobox", { name: "時給の適用期間" }),
    ).toContainText("2025/12/31時点");
    await expect(targetRow).toContainText("1,200円");
  } finally {
    for (const hourlyWageRuleId of hourlyWageRuleIds) {
      await staff.db
        .delete(hourlyWageRules)
        .where(eq(hourlyWageRules.id, hourlyWageRuleId));
    }
    await staff.cleanup();
  }
});

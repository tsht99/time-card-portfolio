import type { Locator, Page } from "@playwright/test";
import {
  attendanceCurrentStates,
  attendanceEvents,
  hourlyWageRules,
} from "@repo/db";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";
import { openTestDatabase } from "web/test-support/browser/database";
import type { HelpScreenshotScenario } from "../test-support/help-screenshot";
import { registerHelpScreenshotScenario } from "../test-support/help-screenshot";

const output = "../../../apps/help/public/images/generated/";
const adminDisplayName = "管理者";
const shared = {
  role: "admin",
  displayName: adminDisplayName,
  fixedNow: "2026-01-01T03:00:00.000Z",
  fixtureOptions: { adminDisplayName },
  viewport: { width: 430, height: 932 },
  browserZoom: 1,
  deviceScaleFactor: 1,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  chromiumLanguage: "ja-JP",
};

async function seedAttendance(
  userId: string,
  date: string,
  workPeriod: "day" | "night",
  start: string,
  end: string,
) {
  const attendanceId = crypto.randomUUID();
  const clockInAt = new Date(`${date}T${start}:00+09:00`);
  const clockOutAt = new Date(`${date}T${end}:00+09:00`);
  const { db, close } = await openTestDatabase();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(attendanceEvents).values([
        {
          attendanceId,
          performedByUserId: userId,
          eventVersion: 1,
          eventType: "AttendanceClockedIn",
          payload: {
            userId,
            workPeriod,
            attendanceDate: date,
            clockInAt: clockInAt.toISOString(),
          },
        },
        {
          attendanceId,
          performedByUserId: userId,
          eventVersion: 2,
          eventType: "AttendanceClockedOut",
          payload: { clockOutAt: clockOutAt.toISOString() },
        },
      ]);
      await tx.insert(attendanceCurrentStates).values({
        attendanceId,
        userId,
        attendanceDate: date,
        workPeriod,
        clockInAt,
        clockOutAt,
        eventVersion: 2,
      });
    });
  } finally {
    await close();
  }
}

async function seedDayWage(userId: string) {
  const { db, close } = await openTestDatabase();
  try {
    await db.insert(hourlyWageRules).values({
      userId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1200,
      effectiveFrom: "2026-01-01",
    });
  } finally {
    await close();
  }
}

async function expectNoRuntimeNoise(page: Page) {
  const body = page.locator("body");
  await expect(body).not.toContainText(/E2E|undefined/);
  await expect(body).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  await expect(body).not.toContainText(/読み込み中|Loading\.\.\./);
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.activeElement === document.body ||
        document.activeElement === document.documentElement,
    ),
  ).toBe(true);
  await expect
    .poll(async () =>
      (await page.locator('[role="alert"]').allTextContents()).filter(
        (text) => text.trim().length > 0,
      ),
    )
    .toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function expectWithinViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "screenshot content should have a bounding box").not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function seedPayrollEstimateStaff(displayName: string) {
  return createAuthenticatedUser({
    displayName,
    role: "staff",
    status: "active",
  });
}

const listScenario = {
  ...shared,
  id: "admin-payroll-estimate-list",
  screenshotId: "admin-payroll-estimate-list",
  route: "/admin/payroll-estimates?month=2026-01",
  output: `${output}admin-payroll-estimate-list.png`,
  register(capture) {
    test("generates admin-payroll-estimate-list help screenshot", async ({
      page,
      admin,
    }) => {
      const staffA = await seedPayrollEstimateStaff("スタッフA");
      const staffB = await seedPayrollEstimateStaff("スタッフB");
      try {
        await seedDayWage(staffA.userId);
        await seedAttendance(
          staffA.userId,
          "2026-01-05",
          "day",
          "09:00",
          "17:00",
        );
        await seedAttendance(
          staffB.userId,
          "2026-01-06",
          "night",
          "18:00",
          "20:00",
        );
        await capture(page, { admin, staffA, staffB });
      } finally {
        await staffB.cleanup();
        await staffA.cleanup();
      }
    });
  },
  async assertReady(page) {
    await expect(
      page.getByRole("heading", { name: "給与見込み一覧" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "2026年1月", exact: true }),
    ).toBeVisible();
    const list = page.getByRole("list", { name: "給与見込み一覧" });
    const staffA = list.getByRole("listitem").filter({ hasText: "スタッフA" });
    const staffB = list.getByRole("listitem").filter({ hasText: "スタッフB" });
    await expect(staffA).toContainText("9,600円");
    await expect(staffB).toContainText("要確認");
    await expect(staffB).toContainText("0円");
    await expect(
      staffA.getByRole("link", {
        name: "スタッフA、給与見込み 9,600円、給与見込み詳細へ移動",
      }),
    ).toBeVisible();
    await expect(
      staffB.getByRole("link", {
        name: "スタッフB、給与見込み 0円、要確認、給与見込み詳細へ移動",
      }),
    ).toBeVisible();
    await expectWithinViewport(page, staffA);
    await expectWithinViewport(page, staffB);
    await expectNoRuntimeNoise(page);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(listScenario, test);

const detailScenario = {
  ...shared,
  id: "admin-payroll-estimate-detail",
  screenshotId: "admin-payroll-estimate-detail",
  route: "/admin/payroll-estimates?month=2026-01",
  output: `${output}admin-payroll-estimate-detail.png`,
  register(capture) {
    test("generates admin-payroll-estimate-detail help screenshot", async ({
      page,
      admin,
    }) => {
      const staff = await seedPayrollEstimateStaff("スタッフA");
      try {
        await seedDayWage(staff.userId);
        await seedAttendance(
          staff.userId,
          "2026-01-05",
          "day",
          "09:00",
          "17:00",
        );
        await seedAttendance(
          staff.userId,
          "2026-01-06",
          "night",
          "18:00",
          "20:00",
        );
        await capture(page, { admin, staff });
      } finally {
        await staff.cleanup();
      }
    });
  },
  async prepare(page, fixtures) {
    const staff = fixtures.staff as { userId: string };
    await page.goto(
      `/admin/users/${staff.userId}/payroll-estimates?month=2026-01`,
    );
  },
  async assertReady(page) {
    const context = page.getByRole("region", { name: "対象ユーザー" });
    await expect(context.getByText("スタッフA", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "2026年1月", exact: true }),
    ).toBeVisible();
    const total = page.getByRole("region", { name: "給与見込み額" });
    await expect(total).toContainText("9,600円");
    await expect(total).toContainText("未算出 1件");
    const list = page.getByRole("list", { name: "勤怠別給与見込み明細" });
    await expect(list.locator("li")).toHaveCount(2);
    const day = list.getByRole("listitem").filter({ hasText: "昼" });
    const night = list.getByRole("listitem").filter({ hasText: "夜" });
    await expect(day).toContainText("1/5（月）");
    await expect(day).toContainText("09:00");
    await expect(day).toContainText("17:00");
    await expect(day).toContainText("1,200円/時");
    await expect(day).toContainText("9,600円");
    await expect(night).toContainText("1/6（火）");
    await expect(night).toContainText("18:00");
    await expect(night).toContainText("20:00");
    await expect(night).toContainText("時給未設定");
    await expectWithinViewport(page, context);
    await expectWithinViewport(page, total);
    await expectWithinViewport(page, day);
    await expectWithinViewport(page, night);
    await expectNoRuntimeNoise(page);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(detailScenario, test);

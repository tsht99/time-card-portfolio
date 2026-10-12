import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import {
  attendanceCurrentStates,
  attendanceEvents,
  hourlyWageRules,
} from "@repo/db";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";
import { openTestDatabase } from "web/test-support/browser/database";
import { testTokyoDateAt } from "web/test-support/browser/reference-time";
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
  attendanceDate: string,
  clockInAt: Date,
  clockOutAt?: Date,
  performedByUserId = userId,
) {
  const attendanceId = randomUUID();
  const { db, close } = await openTestDatabase();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(attendanceEvents).values({
        attendanceId,
        performedByUserId,
        eventVersion: 1,
        eventType: "AttendanceClockedIn",
        payload: {
          userId,
          workPeriod: "day",
          attendanceDate,
          clockInAt: clockInAt.toISOString(),
        },
      });
      if (clockOutAt) {
        await tx.insert(attendanceEvents).values({
          attendanceId,
          performedByUserId,
          eventVersion: 2,
          eventType: "AttendanceClockedOut",
          payload: { clockOutAt: clockOutAt.toISOString() },
        });
      }
      await tx.insert(attendanceCurrentStates).values({
        attendanceId,
        userId,
        attendanceDate,
        workPeriod: "day",
        clockInAt,
        clockOutAt: clockOutAt ?? null,
        eventVersion: clockOutAt ? 2 : 1,
      });
    });
  } finally {
    await close();
  }
  return attendanceId;
}

async function seedHourlyWage(userId: string) {
  const { db, close } = await openTestDatabase();
  try {
    await db.insert(hourlyWageRules).values({
      userId,
      workPeriod: "day",
      dayType: "holiday",
      hourlyWage: 1400,
      effectiveFrom: "2026-01-01",
    });
  } finally {
    await close();
  }
}

async function expectReady(page: Page, expectedNames: string[]) {
  await expect(page.getByRole("heading", { name: "勤怠一覧" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "管理画面のメインナビゲーション" })
      .locator('[aria-current="page"]'),
  ).toHaveText("勤怠");
  const list = page.getByRole("list", { name: "勤怠一覧" });
  await expect(list).toBeVisible();
  const missingClockOutRow = list.getByRole("link", {
    name: /スタッフB.*10:00 - 退勤未記録 勤怠詳細へ移動/,
  });
  await expect(missingClockOutRow).toContainText("--:--");
  await expectWithinViewport(page, missingClockOutRow);
  for (const name of expectedNames) {
    const row = list.getByRole("link", {
      name: new RegExp(`${name}.*勤怠詳細へ移動`),
    });
    await expect(row).toBeVisible();
    await expectWithinViewport(page, row);
  }
  await expect(
    page.getByRole("button", { name: "検索条件を開く" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("E2E");
  await expect(page.locator("body")).not.toContainText("undefined");
  await expect
    .poll(async () =>
      (await page.locator('[role="alert"]').allTextContents()).filter(
        (text) => text.trim().length > 0,
      ),
    )
    .toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function expectWithinViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(
    box,
    "expected screenshot element to have a bounding box",
  ).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

const listScenario = {
  ...shared,
  id: "admin-attendance-list",
  screenshotId: "admin-attendance-list",
  route: "/admin/attendance?from=2026-01-01&to=2026-01-31",
  output: `${output}admin-attendance-list.png`,
  register(capture) {
    test("generates admin-attendance-list help screenshot", async ({
      page,
      admin,
    }) => {
      const staffA = await createAuthenticatedUser({
        displayName: "スタッフA",
        role: "staff",
        status: "active",
      });
      const staffB = await createAuthenticatedUser({
        displayName: "スタッフB",
        role: "staff",
        status: "active",
      });
      try {
        await seedAttendance(
          staffA.userId,
          "2026-01-01",
          testTokyoDateAt(0, "09:00"),
          testTokyoDateAt(0, "17:00"),
        );
        await seedAttendance(
          staffB.userId,
          "2026-01-01",
          testTokyoDateAt(0, "10:00"),
        );
        await page.goto("/admin/attendance?from=2026-01-01&to=2026-01-31");
        await capture(page, { admin });
      } finally {
        await staffB.cleanup();
        await staffA.cleanup();
      }
    });
  },
  async assertReady(page) {
    await expectReady(page, ["スタッフA", "スタッフB"]);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(listScenario, test);

const createScenario = {
  ...shared,
  id: "admin-attendance-create",
  screenshotId: "admin-attendance-create",
  route: "/admin/attendance/new",
  output: `${output}admin-attendance-create.png`,
  register(capture) {
    test("generates admin-attendance-create help screenshot", async ({
      page,
      admin,
    }) => {
      const staff = await createAuthenticatedUser({
        displayName: "スタッフA",
        role: "staff",
        status: "active",
      });
      try {
        await capture(page, { admin, staff });
      } finally {
        await staff.cleanup();
      }
    });
  },
  async prepare(page) {
    await expect(page.getByLabel("作成対象者")).toBeVisible();
    await page.getByLabel("作成対象者").click();
    await page.getByRole("option", { name: "スタッフA", exact: true }).click();
    await page.getByText("昼", { exact: true }).click();
    await page.getByLabel("作成出勤日時").fill("2026-01-02T09:00");
    await page.getByLabel("作成退勤日時").fill("2026-01-02T18:00");
    await page.getByLabel("作成退勤日時").blur();
  },
  async restoreAfterReload(page) {
    await expect(page.getByLabel("作成対象者")).toBeVisible();
    await page.getByLabel("作成対象者").click();
    await page.getByRole("option", { name: "スタッフA", exact: true }).click();
    await page.getByText("昼", { exact: true }).click();
    await page.getByLabel("作成出勤日時").fill("2026-01-02T09:00");
    const clockOut = page.getByLabel("作成退勤日時");
    await clockOut.fill("2026-01-02T18:00");
    await clockOut.blur();
  },
  async assertReady(page) {
    await expect(page.getByRole("heading", { name: "勤怠作成" })).toBeVisible();
    await expect(page.getByLabel("作成対象者")).toHaveText("スタッフA");
    await expect(page.getByText("昼", { exact: true })).toBeVisible();
    await expect(page.getByLabel("作成出勤日時")).toHaveValue(
      "2026-01-02T09:00",
    );
    await expect(page.getByLabel("作成退勤日時")).toHaveValue(
      "2026-01-02T18:00",
    );
    await expect(page.getByRole("button", { name: "作成" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("E2E");
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect
      .poll(async () =>
        (await page.locator('[role="alert"]').allTextContents()).filter(
          (text) => text.trim().length > 0,
        ),
      )
      .toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(createScenario, test);

const detailScenario = {
  ...shared,
  id: "admin-attendance-detail",
  screenshotId: "admin-attendance-detail",
  route: "/admin/attendance",
  output: `${output}admin-attendance-detail.png`,
  register(capture) {
    test("generates admin-attendance-detail help screenshot", async ({
      page,
      admin,
    }) => {
      const staff = await createAuthenticatedUser({
        displayName: "スタッフA",
        role: "staff",
        status: "active",
      });
      try {
        await seedHourlyWage(staff.userId);
        const attendanceId = await seedAttendance(
          staff.userId,
          "2026-01-01",
          testTokyoDateAt(0, "09:00"),
          testTokyoDateAt(0, "17:00"),
          admin.userId,
        );
        await capture(page, { admin, staff, attendanceId });
      } finally {
        await staff.cleanup();
      }
    });
  },
  async prepare(page, fixtures) {
    const { attendanceId } = fixtures as { attendanceId: string };
    await page.goto(`/admin/attendance/${attendanceId}`);
    await showFirstAttendanceOperator(page);
  },
  async restoreAfterReload(page) {
    await showFirstAttendanceOperator(page);
  },
  async assertReady(page) {
    await expect(
      page
        .getByRole("region", { name: "対象ユーザー" })
        .getByText("スタッフA", { exact: true }),
    ).toBeVisible();
    const current = page.getByRole("region", { name: "勤怠の現在状態" });
    await expect(
      current.getByText("2026/01/01", { exact: true }),
    ).toBeVisible();
    await expect(
      current.getByText("2026/01/01 09:00", { exact: true }),
    ).toBeVisible();
    await expect(
      current.getByText("2026/01/01 17:00", { exact: true }),
    ).toBeVisible();
    await expect(current.getByText("昼", { exact: true })).toBeVisible();
    await expect(current.getByText("退勤済み", { exact: true })).toBeVisible();
    await expect(current.getByText(/1,400円\/時/)).toBeVisible();
    await expect(page.getByRole("link", { name: "訂正" })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "変更履歴" })).toBeVisible();
    await expect(
      page.getByText("操作者：管理者", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("E2E");
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect
      .poll(async () =>
        (await page.locator('[role="alert"]').allTextContents()).filter(
          (text) => text.trim().length > 0,
        ),
      )
      .toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expectWithinViewport(
      page,
      page.getByRole("region", { name: "対象ユーザー" }),
    );
    await expectWithinViewport(page, current);
    await expectWithinViewport(page, page.getByRole("link", { name: "訂正" }));
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "取消" }),
    );
    await expectWithinViewport(
      page,
      page.getByRole("heading", { name: "変更履歴" }),
    );
    await expectWithinViewport(
      page,
      page.getByText("出勤を記録（2026/01/01 09:00）", { exact: true }),
    );
    await expectWithinViewport(
      page,
      page.getByText("操作者：管理者", { exact: true }).first(),
    );
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(detailScenario, test);

async function showFirstAttendanceOperator(page: Page) {
  const firstOperator = page
    .getByText("操作者：管理者", { exact: true })
    .first();
  await expect(firstOperator).toBeVisible();
  const operatorBox = await firstOperator.boundingBox();
  const viewport = page.viewportSize();
  if (!operatorBox || !viewport) {
    throw new Error("変更履歴の操作者行の表示寸法を取得できません。");
  }
  const minimumScroll = Math.max(
    0,
    operatorBox.y + operatorBox.height - viewport.height + 12,
  );
  if (minimumScroll > 0) {
    await page.evaluate(
      (scrollBy) => window.scrollBy(0, scrollBy),
      minimumScroll,
    );
  }
}

const correctionScenario = {
  ...shared,
  viewport: { width: 430, height: 1024 },
  id: "admin-attendance-correction",
  screenshotId: "admin-attendance-correction",
  route: "/admin/attendance",
  output: `${output}admin-attendance-correction.png`,
  register(capture) {
    test("generates admin-attendance-correction help screenshot", async ({
      page,
      admin,
    }) => {
      const staff = await createAuthenticatedUser({
        displayName: "スタッフA",
        role: "staff",
        status: "active",
      });
      try {
        await seedHourlyWage(staff.userId);
        const attendanceId = await seedAttendance(
          staff.userId,
          "2026-01-01",
          testTokyoDateAt(0, "09:00"),
          testTokyoDateAt(0, "17:00"),
          admin.userId,
        );
        await capture(page, { admin, staff, attendanceId });
      } finally {
        await staff.cleanup();
      }
    });
  },
  async prepare(page, fixtures) {
    const { attendanceId } = fixtures as { attendanceId: string };
    await page.goto(`/admin/attendance/${attendanceId}/edit`);
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  async restoreAfterReload(page) {
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  async assertReady(page) {
    await expect(page.getByRole("heading", { name: "勤怠訂正" })).toBeVisible();
    await expect(page.getByText("スタッフA", { exact: true })).toBeVisible();
    await expect(page.getByLabel("出勤日時")).toHaveValue("2026-01-01T09:00");
    await expect(page.getByLabel("訂正退勤日時")).toHaveValue(
      "2026-01-01T17:00",
    );
    await expect(page.getByRole("button", { name: "保存" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("E2E");
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect
      .poll(async () =>
        (await page.locator('[role="alert"]').allTextContents()).filter(
          (text) => text.trim().length > 0,
        ),
      )
      .toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expectWithinViewport(
      page,
      page.getByRole("heading", { name: "勤怠訂正" }),
    );
    await expectWithinViewport(
      page,
      page.getByText("スタッフA", { exact: true }),
    );
    await expectWithinViewport(
      page,
      page.getByRole("group", { name: "勤務区分" }),
    );
    await expectWithinViewport(page, page.getByLabel("出勤日時"));
    await expectWithinViewport(page, page.getByLabel("訂正退勤日時"));
    await expectWithinViewport(
      page,
      page.getByRole("form", { name: "勤怠訂正フォーム" }),
    );
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "保存" }),
    );
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(correctionScenario, test);

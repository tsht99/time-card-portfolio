import type { Locator, Page } from "@playwright/test";
import { hourlyWageRules } from "@repo/db";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";
import { openTestDatabase } from "web/test-support/browser/database";
import type { HelpScreenshotScenario } from "../test-support/help-screenshot";
import { registerHelpScreenshotScenario } from "../test-support/help-screenshot";

const output = "../../../apps/help/public/images/generated/";
const adminDisplayName = "管理者";
const screenshotAdminIds = {
  admin: "00000000-0000-4000-8000-000000000001",
  adminB: "00000000-0000-4000-8000-000000000002",
};
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

const usersScenario = {
  ...shared,
  fixtureOptions: { adminDisplayName, adminUserId: screenshotAdminIds.admin },
  id: "admin-users",
  screenshotId: "admin-users",
  route: "/admin/users",
  output: `${output}admin-users.png`,
  register(capture) {
    test("generates admin-users help screenshot", async ({ page, admin }) => {
      const adminB = await createAuthenticatedUser({
        displayName: "管理者B",
        role: "admin",
        status: "active",
        userId: screenshotAdminIds.adminB,
      });
      await expect(
        createAuthenticatedUser({
          displayName: "重複管理者",
          role: "admin",
          status: "active",
          userId: screenshotAdminIds.admin,
        }),
      ).rejects.toThrow();
      const staffA = await createAuthenticatedUser({
        displayName: "スタッフA",
        role: "staff",
        status: "active",
      });
      const staffB = await createAuthenticatedUser({
        displayName: "スタッフB",
        role: "staff",
        status: "pending",
      });
      const staffC = await createAuthenticatedUser({
        displayName: "スタッフC",
        role: "staff",
        status: "inactive",
      });
      try {
        await capture(page, { admin });
      } finally {
        await staffC.cleanup();
        await staffB.cleanup();
        await staffA.cleanup();
        await adminB.cleanup();
      }
    });
  },
  async assertReady(page) {
    await expect(
      page.getByRole("heading", { name: "ユーザー一覧" }),
    ).toBeVisible();
    const adminList = page.getByRole("list", { name: "管理者一覧" });
    const staffList = page.getByRole("list", { name: "スタッフ一覧" });
    await expect(
      adminList.getByRole("link", { name: "管理者 利用中", exact: true }),
    ).toBeVisible();
    await expect(
      adminList.getByRole("link", { name: "管理者B 利用中", exact: true }),
    ).toBeVisible();
    await expect(
      staffList.getByRole("link", { name: /スタッフA.*利用中/ }),
    ).toBeVisible();
    await expect(
      staffList.getByRole("link", { name: /スタッフB.*承認待ち/ }),
    ).toBeVisible();
    await expect(
      staffList.getByRole("link", { name: /スタッフC.*利用停止/ }),
    ).toBeVisible();
    for (const row of [
      ...(await adminList.getByRole("listitem").all()),
      ...(await staffList.getByRole("listitem").all()),
    ])
      await expectWithinViewport(page, row);
    await expectNoRuntimeNoise(page);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(usersScenario, test);

const userDetailScenario = {
  ...shared,
  id: "admin-user-detail",
  screenshotId: "admin-user-detail",
  route: "/admin/users",
  output: `${output}admin-user-detail.png`,
  register(capture) {
    test("generates admin-user-detail help screenshot", async ({
      page,
      admin,
    }) => {
      const staff = await createAuthenticatedUser({
        displayName: "スタッフB",
        role: "staff",
        status: "pending",
      });
      try {
        await capture(page, { admin, staff });
      } finally {
        await staff.cleanup();
      }
    });
  },
  async prepare(page, fixtures) {
    const staff = fixtures.staff as { userId: string };
    await page.goto(`/admin/users/${staff.userId}`);
  },
  async assertReady(page) {
    await expect(
      page.getByRole("heading", { name: "ユーザー詳細" }),
    ).toBeVisible();
    await expect(page.getByText("スタッフB", { exact: true })).toBeVisible();
    await expect(page.getByText("スタッフ", { exact: true })).toBeVisible();
    await expect(page.getByText("承認待ち", { exact: true })).toBeVisible();
    const context = page.getByText("スタッフB", { exact: true });
    await expectWithinViewport(page, context);
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "承認する" }),
    );
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "表示名を編集" }),
    );
    await expectNoRuntimeNoise(page);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(userDetailScenario, test);

const dayTypes = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "holiday",
] as const;
const wageValues = [
  [1200, 1400],
  [1200, 1400],
  [1200, 1400],
  [1200, 1400],
  [1200, 1400],
  [1300, 1500],
  [1400, 1600],
  [1400, 1600],
] as const;

async function seedWages(
  userId: string,
  entries: Array<{
    effectiveFrom: string;
    dayType: (typeof dayTypes)[number];
    workPeriod: "day" | "night";
    hourlyWage: number;
  }>,
) {
  const { db, close } = await openTestDatabase();
  try {
    for (const entry of entries)
      await db.insert(hourlyWageRules).values({ userId, ...entry });
  } finally {
    await close();
  }
}

const hourlyWagesScenario = {
  ...shared,
  id: "admin-hourly-wages",
  screenshotId: "admin-hourly-wages",
  route: "/admin/users",
  output: `${output}admin-hourly-wages.png`,
  register(capture) {
    test("generates admin-hourly-wages help screenshot", async ({
      page,
      admin,
    }) => {
      const staff = await createAuthenticatedUser({
        displayName: "スタッフA",
        role: "staff",
        status: "active",
      });
      try {
        await seedWages(
          staff.userId,
          dayTypes.flatMap((dayType, index) => [
            {
              effectiveFrom: "2026-01-01",
              dayType,
              workPeriod: "day" as const,
              hourlyWage: wageValues[index][0],
            },
            {
              effectiveFrom: "2026-01-01",
              dayType,
              workPeriod: "night" as const,
              hourlyWage: wageValues[index][1],
            },
          ]),
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
      `/admin/users/${staff.userId}/hourly-wage-rules?date=2026-01-01`,
    );
  },
  async assertReady(page) {
    await expect(page.getByRole("heading", { name: "時給設定" })).toBeVisible();
    await expect(page.getByText("スタッフA", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "時給の適用期間" }),
    ).toContainText("2026/01/01時点");
    const matrix = page.getByRole("table", { name: "曜日別・昼夜別の時給" });
    await expect(matrix).toBeVisible();
    for (const [index, dayType] of [
      "月",
      "火",
      "水",
      "木",
      "金",
      "土",
      "日",
      "祝日",
    ].entries()) {
      const row = matrix.getByRole("row", { name: new RegExp(`^${dayType} `) });
      await expect(row).toContainText(
        `${wageValues[index][0].toLocaleString("ja-JP")}円`,
      );
      await expect(row).toContainText(
        `${wageValues[index][1].toLocaleString("ja-JP")}円`,
      );
    }
    await expectWithinViewport(page, matrix);
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "時給を編集" }),
    );
    await expectWithinViewport(
      page,
      page.getByRole("link", { name: "時給履歴" }),
    );
    await expectNoRuntimeNoise(page);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(hourlyWagesScenario, test);

const wageHistoryScenario = {
  ...shared,
  id: "admin-hourly-wage-history",
  screenshotId: "admin-hourly-wage-history",
  route: "/admin/users",
  output: `${output}admin-hourly-wage-history.png`,
  register(capture) {
    test("generates admin-hourly-wage-history help screenshot", async ({
      page,
      admin,
    }) => {
      const staff = await createAuthenticatedUser({
        displayName: "スタッフA",
        role: "staff",
        status: "active",
      });
      try {
        await seedWages(staff.userId, [
          {
            effectiveFrom: "2025-12-01",
            dayType: "mon",
            workPeriod: "day",
            hourlyWage: 1100,
          },
          {
            effectiveFrom: "2025-12-01",
            dayType: "sat",
            workPeriod: "night",
            hourlyWage: 1450,
          },
          {
            effectiveFrom: "2026-01-01",
            dayType: "mon",
            workPeriod: "day",
            hourlyWage: 1200,
          },
          {
            effectiveFrom: "2026-01-01",
            dayType: "holiday",
            workPeriod: "night",
            hourlyWage: 1600,
          },
        ]);
        await capture(page, { admin, staff });
      } finally {
        await staff.cleanup();
      }
    });
  },
  async prepare(page, fixtures) {
    const staff = fixtures.staff as { userId: string };
    await page.goto(`/admin/users/${staff.userId}/hourly-wage-rules/history`);
  },
  async restoreAfterReload(page) {
    await page
      .getByText("2026/01/01から", { exact: true })
      .scrollIntoViewIfNeeded();
  },
  async assertReady(page) {
    await expect(page.getByRole("heading", { name: "時給履歴" })).toBeVisible();
    await expect(page.getByText("スタッフA", { exact: true })).toBeVisible();
    await expect(
      page.getByText("2026/01/01から", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("2025/12/01から", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("月昼1,100円 → 1,200円", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("土夜未設定 → 1,450円", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("祝日夜未設定 → 1,600円", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "時給ルールを訂正" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "時給ルールを削除" }).first(),
    ).toBeVisible();
    const latest = page.getByText("2026/01/01から", { exact: true });
    const earliest = page.getByText("2025/12/01から", { exact: true });
    await latest.scrollIntoViewIfNeeded();
    await expectWithinViewport(page, latest);
    await expectWithinViewport(page, earliest);
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "時給ルールを訂正" }).first(),
    );
    await expectWithinViewport(
      page,
      page.getByRole("button", { name: "時給ルールを削除" }).first(),
    );
    await expectNoRuntimeNoise(page);
  },
} satisfies HelpScreenshotScenario;
registerHelpScreenshotScenario(wageHistoryScenario, test);

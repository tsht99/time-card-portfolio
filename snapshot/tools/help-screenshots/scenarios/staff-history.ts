import { testTokyoDateAt } from "web/test-support/browser/reference-time";
import { expect, test } from "web/test-support/browser/staff-fixture";
import type { HelpScreenshotScenario } from "../test-support/help-screenshot";
import { registerHelpScreenshotScenario } from "../test-support/help-screenshot";

const scenario = {
  id: "staff-history",
  screenshotId: "staff-history",
  route: "/history?month=2026-01",
  role: "staff",
  displayName: "スタッフ",
  fixedNow: "2026-01-01T03:00:00.000Z",
  fixtureOptions: {
    staffDisplayName: "スタッフ",
    staffFixedNow: "2026-01-01T03:00:00.000Z",
  },
  workPeriod: "day",
  viewport: { width: 430, height: 932 },
  browserZoom: 1,
  deviceScaleFactor: 1,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  chromiumLanguage: "ja-JP",
  output: "../../../apps/help/public/images/generated/staff-history.png",
  register(capture) {
    test("generates staff-history help screenshot", async ({ page, staff }) => {
      await staff.seedCompleted({
        workPeriod: "day",
        clockInAt: testTokyoDateAt(0, "09:00"),
        clockOutAt: testTokyoDateAt(0, "17:00"),
      });
      await staff.seedCompleted({
        workPeriod: "night",
        clockInAt: testTokyoDateAt(0, "18:00"),
        clockOutAt: testTokyoDateAt(1, "01:00"),
      });
      await capture(page, { staff });
    });
  },
  async assertReady(page) {
    await expect(
      page.getByRole("heading", { name: "2026年1月" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "前の月" })).toBeVisible();
    await expect(page.getByRole("button", { name: "次の月" })).toBeVisible();
    await expect(page.getByText("1日", { exact: true })).toHaveCount(2);
    await expect(page.getByText(/09:00\s*→\s*17:00/)).toBeVisible();
    await expect(page.getByText(/18:00\s*→\s*25:00/)).toBeVisible();
    await expect(page.getByRole("link", { name: "履歴" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator('section[aria-live="polite"]')).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("body")).not.toContainText("E2E");
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect(
      page.locator('[role="alert"]:not(#__next-route-announcer__)'),
    ).toHaveCount(0);
    await expect(page.locator("[aria-live='polite']")).toHaveCount(1);
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
    expect(dimensions.documentHeight).toBeLessThanOrEqual(
      dimensions.viewportHeight,
    );
  },
} satisfies HelpScreenshotScenario;

registerHelpScreenshotScenario(scenario, test);

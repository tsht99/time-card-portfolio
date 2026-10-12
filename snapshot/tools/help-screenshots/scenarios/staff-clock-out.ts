import type { Page } from "@playwright/test";
import { testTokyoDateAt } from "web/test-support/browser/reference-time";
import { expect, test } from "web/test-support/browser/staff-fixture";
import type { HelpScreenshotScenario } from "../test-support/help-screenshot";
import { registerHelpScreenshotScenario } from "../test-support/help-screenshot";

const fixedNow = "2026-01-01T09:00:00.000Z";

const scenario = {
  id: "staff-clock-out",
  screenshotId: "staff-clock-out",
  route: "/clock",
  role: "staff",
  displayName: "スタッフ",
  fixedNow,
  fixtureOptions: { staffDisplayName: "スタッフ", staffFixedNow: fixedNow },
  inputTime: "17:30",
  workPeriod: "day",
  viewport: { width: 430, height: 932 },
  browserZoom: 1,
  deviceScaleFactor: 1,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  chromiumLanguage: "ja-JP",
  output: "../../../apps/help/public/images/generated/staff-clock-out.png",
  register(capture) {
    test("generates staff-clock-out help screenshot", async ({
      page,
      staff,
    }) => {
      await staff.seedWorking({
        workPeriod: "day",
        clockInAt: testTokyoDateAt(0, "09:00"),
      });
      await capture(page, { staff });
    });
  },
  async prepare(page: Page) {
    const timeInput = page.getByLabel("打刻時刻");
    await expect(page.getByRole("button", { name: "退勤" })).toBeEnabled();
    await expect(timeInput).toBeEnabled();
    await timeInput.fill("17:30");
    await expect(timeInput).toHaveValue("17:30");
    await timeInput.evaluate((element: HTMLInputElement) => element.blur());
    await expect(timeInput).not.toBeFocused();
  },
  async restoreAfterReload(page: Page) {
    const timeInput = page.getByLabel("打刻時刻");
    await timeInput.fill("17:30");
    await timeInput.evaluate((element: HTMLInputElement) => element.blur());
    await expect(timeInput).not.toBeFocused();
  },
  async assertReady(page: Page) {
    await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
    await expect(page.getByText(/09:00/)).toBeVisible();
    await expect(page.getByRole("button", { name: "退勤" })).toBeEnabled();
    await expect(page.getByLabel("打刻時刻")).toHaveValue("17:30");
    await expect(page.locator("body")).not.toContainText("E2E");
    await expect(page.locator("body")).not.toContainText("undefined");
    await expect(page.locator("#__next-route-announcer__")).toHaveText("");
    await expect(
      page.locator('[role="alert"]:not(#__next-route-announcer__)'),
    ).toHaveCount(0);
    await expect(page.locator("[aria-live='polite']")).toHaveCount(0);
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

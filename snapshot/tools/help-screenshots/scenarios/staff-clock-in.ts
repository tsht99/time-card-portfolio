import type { Page } from "@playwright/test";
import { TEST_REFERENCE_TIME_ISO } from "web/test-support/browser/reference-time";
import { expect, test } from "web/test-support/browser/staff-fixture";
import type { HelpScreenshotScenario } from "../test-support/help-screenshot";
import { registerHelpScreenshotScenario } from "../test-support/help-screenshot";

const displayedDate = "2026年1月1日（木）";
const timeInputLabel = `打刻時刻 ${displayedDate}`;

/** Reproducible input and output contract for the staff clock-in guide image. */
const staffClockInScreenshotScenario = {
  id: "staff-clock-in",
  screenshotId: "staff-clock-in",
  route: "/clock",
  role: "staff",
  displayName: "スタッフ",
  fixedNow: TEST_REFERENCE_TIME_ISO,
  fixtureOptions: {
    staffDisplayName: "スタッフ",
    staffFixedNow: TEST_REFERENCE_TIME_ISO,
  },
  inputTime: "09:00",
  workPeriod: "day",
  viewport: { width: 430, height: 932 },
  browserZoom: 1,
  deviceScaleFactor: 1,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  chromiumLanguage: "ja-JP",
  output: "../../../apps/help/public/images/generated/staff-clock-in.png",
  register(capture) {
    test("generates staff-clock-in help screenshot", async ({ page, staff }) =>
      capture(page, { staff }));
  },
  async prepare(page: Page) {
    const inputTime = staffClockInScreenshotScenario.inputTime;
    if (!inputTime)
      throw new Error("staff-clock-in requires a fixed input time");
    await expect(page.getByRole("button", { name: "昼に出勤" })).toBeEnabled();
    const timeInput = page.getByLabel(timeInputLabel);
    await expect(timeInput).toBeEnabled();
    await timeInput.fill(inputTime);
    await expect(timeInput).toHaveValue(inputTime);
    await timeInput.evaluate((element: HTMLInputElement) => element.blur());
    await expect(timeInput).not.toBeFocused();
  },
  async restoreAfterReload(page: Page) {
    const inputTime = staffClockInScreenshotScenario.inputTime;
    if (!inputTime)
      throw new Error("staff-clock-in requires a fixed input time");
    const timeInput = page.getByLabel(timeInputLabel);
    await timeInput.fill(inputTime);
    await timeInput.evaluate((element: HTMLInputElement) => element.blur());
    await expect(timeInput).not.toBeFocused();
  },
  async assertReady(page: Page) {
    await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
    await expect(page.getByText(displayedDate, { exact: true })).toBeVisible();
    const dateBox = await page
      .getByText(displayedDate, { exact: true })
      .boundingBox();
    const timeInput = page.getByLabel(timeInputLabel);
    await expect(timeInput).toBeVisible();
    const inputBox = await timeInput.boundingBox();
    expect(dateBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    if (dateBox && inputBox)
      expect(dateBox.x + dateBox.width).toBeLessThan(inputBox.x);
    await expect(page.getByRole("button", { name: "昼に出勤" })).toBeVisible();
    await expect(page.getByRole("button", { name: "夜に出勤" })).toBeVisible();
    await expect(page.getByText("昼勤務中", { exact: true })).toHaveCount(0);
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
    await expect(timeInput).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "昼に出勤" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "夜に出勤" }),
    ).toBeInViewport();
  },
} satisfies HelpScreenshotScenario;

registerHelpScreenshotScenario(staffClockInScreenshotScenario, test);

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "web/test-support/browser/staff-fixture";

const recordingPath = resolve(process.cwd(), "public/recordings/clock-in.webm");
let temporaryRecordingPath: string | undefined;

test.use({
  staffFixedNow: "2026-01-01T03:00:00.000Z",
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  viewport: { width: 430, height: 932 },
  launchOptions: { args: ["--lang=ja-JP"] },
  video: { mode: "on", size: { width: 430, height: 932 } },
});

test.afterEach(async ({ page }) => {
  const video = page.video();
  if (video) temporaryRecordingPath = await video.path();
});

test.afterAll(async () => {
  if (!temporaryRecordingPath)
    throw new Error("Playwright did not produce a clock-in recording.");
  await mkdir(dirname(recordingPath), { recursive: true });
  await copyFile(temporaryRecordingPath, recordingPath);
});

test("records the staff clock-in tutorial scenario", async ({
  page,
  staff,
}) => {
  await page.goto("/clock");
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2026年1月1日（木）", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1_000);

  // Keep each action after its matching narration has started and finished.
  await page.waitForTimeout(9_000);
  await page.getByLabel("打刻時刻 2026年1月1日（木）").fill("09:00");
  await page.waitForTimeout(3_000);
  await page.getByRole("button", { name: "昼に出勤" }).click();
  await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
  await expect(page.getByText("09:00", { exact: true })).toBeVisible();
  await expect.poll(() => staff.eventCount()).toBe(1);
  await page.waitForTimeout(6_200);
});

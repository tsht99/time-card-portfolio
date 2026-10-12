import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { testTokyoDateAt } from "web/test-support/browser/reference-time";
import { expect, test } from "web/test-support/browser/staff-fixture";

const recordingPath = resolve(
  process.cwd(),
  "public/recordings/clock-out.webm",
);
let temporaryRecordingPath: string | undefined;

test.use({
  staffDisplayName: "スタッフ",
  staffFixedNow: "2026-01-01T03:00:00.000Z",
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  viewport: { width: 430, height: 932 },
  launchOptions: { args: ["--lang=ja-JP"] },
  video: { mode: "on", size: { width: 430, height: 932 } },
});

test.beforeEach(async ({ staff }) => {
  await staff.seedWorking({
    workPeriod: "day",
    clockInAt: testTokyoDateAt(0, "09:00"),
  });
});

test.afterEach(async ({ page }) => {
  const video = page.video();
  if (video) temporaryRecordingPath = await video.path();
});

test.afterAll(async () => {
  if (!temporaryRecordingPath)
    throw new Error("Playwright did not produce a clock-out recording.");
  await mkdir(dirname(recordingPath), { recursive: true });
  await copyFile(temporaryRecordingPath, recordingPath);
});

test("records the staff clock-out tutorial scenario", async ({
  page,
  staff,
}) => {
  await page.goto("/clock");
  await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
  await expect(page.getByText("09:00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2026年1月1日（木）", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(11_500);

  const timeInput = page.getByLabel("打刻時刻 2026年1月1日（木）");
  await timeInput.fill("17:30");
  await expect(timeInput).toHaveValue("17:30");
  await page.waitForTimeout(2_600);

  await page.getByRole("button", { name: "退勤" }).click();
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
  await expect.poll(async () => (await staff.events()).length).toBe(2);
  await page.waitForTimeout(5_700);
});

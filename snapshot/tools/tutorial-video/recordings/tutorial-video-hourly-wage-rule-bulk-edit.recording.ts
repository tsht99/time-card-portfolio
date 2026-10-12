import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { hourlyWageRules } from "@repo/db";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";

const recordingPath = resolve(
  process.cwd(),
  "public/recordings/hourly-wage-rule-bulk-edit.webm",
);
let temporaryRecordingPath: string | undefined;

test.use({
  adminDisplayName: "管理者",
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
  if (!temporaryRecordingPath) {
    throw new Error(
      "Playwright did not produce an hourly-wage-rule-bulk-edit recording.",
    );
  }
  await mkdir(dirname(recordingPath), { recursive: true });
  await copyFile(temporaryRecordingPath, recordingPath);
});

test("records the admin hourly wage bulk edit tutorial scenario", async ({
  page,
  admin: _admin,
}) => {
  test.setTimeout(70_000);
  const staff = await createAuthenticatedUser({
    displayName: "スタッフA",
    role: "staff",
    status: "active",
  });
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

  try {
    await staff.db.insert(hourlyWageRules).values(
      dayTypes.flatMap((dayType, index) => [
        {
          userId: staff.userId,
          effectiveFrom: "2026-01-01",
          dayType,
          workPeriod: "day" as const,
          hourlyWage: wageValues[index][0],
        },
        {
          userId: staff.userId,
          effectiveFrom: "2026-01-01",
          dayType,
          workPeriod: "night" as const,
          hourlyWage: wageValues[index][1],
        },
      ]),
    );

    await page.goto(
      `/admin/users/${staff.userId}/hourly-wage-rules?date=2026-01-01`,
    );
    await expect(page.getByRole("heading", { name: "時給設定" })).toBeVisible();
    await expect(page.getByText("スタッフA", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "時給の適用期間" }),
    ).toContainText("2026/01/01時点");
    const matrix = page.getByRole("table", { name: "曜日別・昼夜別の時給" });
    await expect(matrix).toBeVisible();
    const monday = matrix.getByRole("row", { name: /^月 / });
    const tuesday = matrix.getByRole("row", { name: /^火 / });
    const mondayDayCell = monday.getByRole("cell").nth(0);
    const tuesdayNightCell = tuesday.getByRole("cell").nth(1);
    await expect(monday).toContainText("1,200円");
    await expect(monday).toContainText("1,400円");
    await expect(tuesday).toContainText("1,200円");
    await expect(tuesday).toContainText("1,400円");
    await page.waitForTimeout(7_700);

    await page.getByRole("button", { name: "時給を編集" }).click();
    const effectiveFrom = page.getByLabel("適用開始日");
    await expect(effectiveFrom).toHaveValue("2026-01-01");
    await page.waitForTimeout(8_500);

    await effectiveFrom.fill("2026-02-01");
    await expect(effectiveFrom).toHaveValue("2026-02-01");
    await page.waitForTimeout(15_300);

    const mondayDay = page.getByLabel("月 昼の変更時給");
    const tuesdayNight = page.getByLabel("火 夜の変更時給");
    await mondayDay.fill("1300");
    await expect(mondayDay).toHaveValue("1300");
    await tuesdayNight.fill("1500");
    await expect(tuesdayNight).toHaveValue("1500");
    await page.waitForTimeout(6_700);

    const saveButton = page.getByRole("button", { name: "保存" });
    await saveButton.scrollIntoViewIfNeeded();
    await expect(saveButton).toBeVisible();
    await saveButton.click();
    await expect(
      page.getByText("時給を更新しました。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "時給の適用期間" }),
    ).toContainText("2026/02/01から");
    await expect(mondayDayCell).toHaveText("1,300円");
    await expect(tuesdayNightCell).toHaveText("1,500円");
    await page.waitForTimeout(17_500);
  } finally {
    await staff.cleanup();
  }
});

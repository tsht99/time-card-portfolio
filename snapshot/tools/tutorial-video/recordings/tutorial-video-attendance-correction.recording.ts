import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { attendanceCurrentStates, attendanceEvents } from "@repo/db";
import { eq } from "drizzle-orm";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";
import { testTokyoDateAt } from "web/test-support/browser/reference-time";

const recordingPath = resolve(
  process.cwd(),
  "public/recordings/attendance-correction.webm",
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
      "Playwright did not produce an attendance-correction recording.",
    );
  }
  await mkdir(dirname(recordingPath), { recursive: true });
  await copyFile(temporaryRecordingPath, recordingPath);
});

test("records the admin attendance correction tutorial scenario", async ({
  page,
  admin: _admin,
}) => {
  test.setTimeout(55_000);
  const staff = await createAuthenticatedUser({
    displayName: "スタッフA",
    role: "staff",
    status: "active",
  });
  const attendanceId = randomUUID();
  const clockInAt = testTokyoDateAt(0, "09:00");
  const clockOutAt = testTokyoDateAt(0, "17:00");
  const attendanceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(clockInAt);

  try {
    await staff.db.transaction(async (tx) => {
      await tx.insert(attendanceEvents).values([
        {
          attendanceId,
          performedByUserId: staff.userId,
          eventVersion: 1,
          eventType: "AttendanceClockedIn",
          payload: {
            userId: staff.userId,
            workPeriod: "day",
            attendanceDate,
            clockInAt: clockInAt.toISOString(),
          },
        },
        {
          attendanceId,
          performedByUserId: staff.userId,
          eventVersion: 2,
          eventType: "AttendanceClockedOut",
          payload: { clockOutAt: clockOutAt.toISOString() },
        },
      ]);
      await tx.insert(attendanceCurrentStates).values({
        attendanceId,
        userId: staff.userId,
        attendanceDate,
        workPeriod: "day",
        clockInAt,
        clockOutAt,
        eventVersion: 2,
      });
    });

    await page.goto(`/admin/attendance/${attendanceId}`);
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
    const detailSummary = page.getByRole("region", { name: "勤怠の現在状態" });
    const currentStaffContext = page.getByRole("region", {
      name: "対象ユーザー",
    });
    await expect(
      currentStaffContext.getByText("スタッフA", { exact: true }),
    ).toBeVisible();
    await expect(
      detailSummary.getByText("2026/01/01", { exact: true }),
    ).toBeVisible();
    await expect(detailSummary.getByText("昼", { exact: true })).toBeVisible();
    await expect(
      detailSummary.getByText("2026/01/01 09:00", { exact: true }),
    ).toBeVisible();
    await expect(
      detailSummary.getByText("2026/01/01 17:00", { exact: true }),
    ).toBeVisible();
    await expect(
      detailSummary.getByText("退勤済み", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(13_900);

    await page.getByRole("link", { name: "訂正" }).click();
    await expect(page).toHaveURL(`/admin/attendance/${attendanceId}/edit`);
    await expect(page.getByRole("heading", { name: "勤怠訂正" })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "対象ユーザー" })
        .getByText("スタッフA", { exact: true }),
    ).toBeVisible();
    const correctionSummary = page.getByRole("region", {
      name: "現在登録されている勤怠",
    });
    await expect(
      correctionSummary.getByText("2026/01/01", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("出勤日時")).toHaveValue("2026-01-01T09:00");
    const clockOutInput = page.getByLabel("訂正退勤日時");
    await expect(clockOutInput).toHaveValue("2026-01-01T17:00");
    const saveButton = page.getByRole("button", { name: "保存" });

    await clockOutInput.evaluate((input) =>
      input.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    await expect
      .poll(async () => {
        const [inputBox, saveButtonBox] = await Promise.all([
          clockOutInput.boundingBox(),
          saveButton.boundingBox(),
        ]);
        return (
          inputBox !== null &&
          saveButtonBox !== null &&
          inputBox.y >= 0 &&
          inputBox.y + inputBox.height <= 932 &&
          saveButtonBox.y >= 0 &&
          saveButtonBox.y + saveButtonBox.height <= 932
        );
      })
      .toBe(true);
    await page.waitForTimeout(9_700);
    await clockOutInput.fill("2026-01-01T18:00");
    await expect(clockOutInput).toHaveValue("2026-01-01T18:00");
    await page.waitForTimeout(5_800);
    await saveButton.click();
    await expect(page).toHaveURL(`/admin/attendance/${attendanceId}`);
    await expect(page.getByRole("heading", { name: "勤怠詳細" })).toBeVisible();
    await expect(
      detailSummary.getByText("2026/01/01 09:00", { exact: true }),
    ).toBeVisible();
    await expect(
      detailSummary.getByText("2026/01/01 18:00", { exact: true }),
    ).toBeVisible();
    await expect(
      detailSummary.getByText("退勤済み", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("退勤時刻を訂正（2026/01/01 18:00）", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("操作者：管理者", { exact: true }).last(),
    ).toBeVisible();
    await page.waitForTimeout(9_500);
  } finally {
    await staff.db
      .delete(attendanceCurrentStates)
      .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
    await staff.db
      .delete(attendanceEvents)
      .where(eq(attendanceEvents.attendanceId, attendanceId));
    await staff.cleanup();
  }
});

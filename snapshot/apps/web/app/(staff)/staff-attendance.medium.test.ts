import { testTokyoDateAt } from "web/test-support/browser/reference-time";
import { expect, test } from "web/test-support/browser/staff-fixture";

test("ルートから打刻画面へリダイレクトする", async ({ page, staff }) => {
  void staff;
  await page.goto("/");
  await expect(page).toHaveURL(/\/clock$/);
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
});

test("打刻画面のnative time inputは日本語24時間localeで表示する", async ({
  page,
  staff,
}) => {
  void staff;
  await page.goto("/clock");
  const browserSettings = await page.evaluate(() => ({
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    formattedTime: new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date("2026-01-01T03:00:00.000Z")),
    inputType:
      document.querySelector<HTMLInputElement>("input[type='time']")?.type,
  }));
  expect(browserSettings).toEqual({
    language: "ja-JP",
    timezone: "Asia/Tokyo",
    formattedTime: "12:00",
    inputType: "time",
  });
  await expect(page.getByLabel("打刻時刻 2026年1月1日（木）")).toHaveValue(
    "12:00",
  );
});

test("staffが昼の出勤を打刻できる", async ({ page, staff }) => {
  await page.goto("/clock");
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2026年1月1日（木）", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("打刻時刻 2026年1月1日（木）")).toHaveValue(
    "12:00",
  );
  await expect(page.getByText("打刻時刻", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "昼に出勤" }).click();
  await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
  await expect.poll(() => staff.eventCount()).toBe(1);
  const [clockIn] = await staff.events();
  expect(clockIn).toMatchObject({
    eventType: "AttendanceClockedIn",
    payload: { clockInAt: "2026-01-01T03:00:00.000Z" },
  });
});

test("表示日付と未編集時刻を保ち、日付境界後も表示を自動更新しない", async ({
  page,
  staff,
}) => {
  void staff;
  await page.goto("/clock");
  const date = page.getByText("2026年1月1日（木）", { exact: true });
  const time = page.getByLabel("打刻時刻 2026年1月1日（木）");
  await expect(date).toBeVisible();
  await expect(time).toHaveValue("12:00");
  await page.clock.setFixedTime("2026-01-01T15:01:00.000Z");
  await expect(date).toBeVisible();
  await expect(time).toHaveValue("12:00");
});

test("編集した時刻を表示日付と組み合わせて打刻する", async ({
  page,
  staff,
}) => {
  await page.goto("/clock");
  await page.getByLabel("打刻時刻 2026年1月1日（木）").fill("13:45");
  await page.getByRole("button", { name: "昼に出勤" }).click();
  await expect.poll(() => staff.eventCount()).toBe(1);
  const [clockIn] = await staff.events();
  expect(clockIn).toMatchObject({
    eventType: "AttendanceClockedIn",
    payload: { clockInAt: "2026-01-01T04:45:00.000Z" },
  });
});

test("当日勤務中Attendanceを取得して昼勤務状態と実出勤時刻を復元する", async ({
  page,
  staff,
}) => {
  await staff.seedWorking({
    workPeriod: "day",
    clockInAt: testTokyoDateAt(0, "09:00"),
  });
  await page.goto("/clock");
  await expect(page.getByRole("status")).toHaveText("昼勤務中");
  await expect(
    page
      .getByRole("heading", { name: "今日の勤怠" })
      .locator("..")
      .getByText("09:00", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("昼勤務中");
  await expect(
    page
      .getByRole("heading", { name: "今日の勤怠" })
      .locator("..")
      .getByText("09:00", { exact: true }),
  ).toBeVisible();
});

test("前日からの正常な勤務は通常の退勤で既存Attendanceを終了する", async ({
  page,
  staff,
}) => {
  const attendanceId = await staff.seedWorking({
    workPeriod: "day",
    clockInAt: testTokyoDateAt(-1, "09:00"),
  });
  await page.goto("/clock");
  await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
  await expect(
    page.getByText("今日の打刻はありません。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退勤" }).click();
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
  await expect.poll(async () => (await staff.events()).length).toBe(2);
  const events = await staff.events();
  expect(new Set(events.map((event) => event.attendanceId))).toEqual(
    new Set([attendanceId]),
  );
  expect(events).toContainEqual({
    attendanceId,
    eventType: "AttendanceClockedOut",
    eventVersion: 2,
    payload: expect.objectContaining({ clockOutAt: expect.any(String) }),
  });
});

test("当日完了Attendanceの実時刻を表示する", async ({ page, staff }) => {
  await staff.seedCompleted({
    workPeriod: "day",
    clockInAt: testTokyoDateAt(0, "09:00"),
    clockOutAt: testTokyoDateAt(0, "17:00"),
  });
  await page.goto("/clock");
  await expect(page.getByRole("heading", { name: "今日の勤怠" })).toBeVisible();
  await expect(page.getByText(/09:00\s*→\s*17:00/)).toBeVisible();
});

test("月次勤怠履歴画面で対象月と本人勤怠を閲覧できる", async ({
  page,
  staff,
}) => {
  await staff.seedCompleted({
    workPeriod: "day",
    clockInAt: testTokyoDateAt(0, "09:00"),
    clockOutAt: testTokyoDateAt(0, "17:00"),
  });
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "2026年1月" })).toBeVisible();
  await expect(page.getByRole("button", { name: "前の月" })).toBeVisible();
  await expect(page.getByRole("button", { name: "次の月" })).toBeVisible();
  await expect(page.getByText("1日", { exact: true })).toBeVisible();
  await expect(page.getByText(/09:00\s*→\s*17:00/)).toBeVisible();
  const historyNavigation = page.getByRole("group", {
    name: "月次勤怠の月ナビゲーション",
  });
  const historyPanel = page.locator('section[aria-live="polite"]');
  await historyNavigation.getByRole("button", { name: "次の月" }).click();
  await expect(page).toHaveURL("/history?month=2026-02");
  await expect(page.getByRole("heading", { name: "2026年2月" })).toBeVisible();
  await expect(historyPanel).toHaveAttribute("aria-busy", "false");
  await historyNavigation.getByRole("button", { name: "前の月" }).click();
  await expect(page).toHaveURL("/history?month=2026-01");
  await expect(page.getByRole("heading", { name: "2026年1月" })).toBeVisible();
  await expect(historyPanel).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText(/09:00\s*→\s*17:00/)).toBeVisible();
  await expect(page.getByRole("link", { name: "履歴" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

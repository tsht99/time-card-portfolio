import type { Page } from "@playwright/test";

import { e2eTokyoDateAt } from "../reference-time";
import { expect, test } from "./support/staff-fixture";

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.body.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function expectStaffLayout(page: Page, active: "clock" | "history") {
  const navigation = page.getByRole("navigation", {
    name: "勤怠画面の切り替え",
  });
  const activeTab = page.getByRole("link", {
    name: active === "clock" ? "打刻" : "履歴",
  });
  const inactiveTab = page.getByRole("link", {
    name: active === "clock" ? "履歴" : "打刻",
  });

  await expect(navigation).toBeVisible();
  await expect(activeTab).toHaveAttribute("aria-current", "page");
  await expect(inactiveTab).toBeEnabled();
  if (active === "clock") {
    await expect(page.getByLabel("打刻時刻")).toBeVisible();
  } else {
    await expect(page.locator('section[aria-live="polite"]')).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  await expectNoHorizontalOverflow(page);
}

test("Staff画面は320pxと390pxで主要操作が画面内に収まる", async ({
  page,
  staff: _staff,
}) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/clock", "/history"] as const) {
      await page.goto(route);
      await expectStaffLayout(page, route === "/clock" ? "clock" : "history");

      const nextTab = page.getByRole("link", {
        name: route === "/clock" ? "履歴" : "打刻",
      });
      await nextTab.click();
      await expect(page).toHaveURL(
        route === "/clock" ? /\/history$/ : /\/clock$/,
      );
      await expectStaffLayout(page, route === "/clock" ? "history" : "clock");
    }
  }
});

test("ルートから打刻画面へリダイレクトする", async ({
  page,
  staff: _staff,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/clock$/);
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
});

test("staffが昼の出勤を打刻できる", async ({ page, staff }) => {
  await page.goto("/clock");
  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "昼に出勤" }).click();
  await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("昼勤務中", { exact: true })).toBeVisible();
  await expect.poll(() => staff.eventCount()).toBe(1);
});

test("当日勤務中Attendanceを取得して昼勤務状態と実出勤時刻を復元する", async ({
  page,
  staff,
}) => {
  await staff.seedWorking({
    workPeriod: "day",
    clockInAt: e2eTokyoDateAt(0, "09:00"),
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
    clockInAt: e2eTokyoDateAt(-1, "09:00"),
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
  });
});

test("当日完了Attendanceの実時刻を表示する", async ({ page, staff }) => {
  await staff.seedCompleted({
    workPeriod: "day",
    clockInAt: e2eTokyoDateAt(0, "09:00"),
    clockOutAt: e2eTokyoDateAt(0, "17:00"),
  });
  await page.goto("/clock");
  await expect(page.getByRole("heading", { name: "今日の勤怠" })).toBeVisible();
  await expect(page.getByText(/09:00\s*→\s*17:00/)).toBeVisible();
});

test("390px幅の月次勤怠履歴画面で対象月と本人勤怠を閲覧できる", async ({
  page,
  staff,
}) => {
  await staff.seedCompleted({
    workPeriod: "day",
    clockInAt: e2eTokyoDateAt(0, "09:00"),
    clockOutAt: e2eTokyoDateAt(0, "17:00"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
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

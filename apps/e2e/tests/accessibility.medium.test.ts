import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { attendanceCurrentStates, attendanceEvents, users } from "@repo/db";
import { eq } from "drizzle-orm";

import { e2eTokyoDateAt } from "../reference-time";
import {
  expect as adminExpect,
  test as adminTest,
} from "./support/admin-fixture";
import { createAuthenticatedUser } from "./support/authenticated-user-fixture";
import { expect, test } from "./support/staff-fixture";

test("存在しないURLは日本語の404画面を返しアクセシビリティ違反がない", async ({
  page,
  staff: _staff,
}) => {
  const response = await page.goto("/not-a-real-timecard-page");

  expect(response?.status()).toBe(404);
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "ページが見つかりません",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("This page could not be found.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);

  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  expect(
    accessibilityScanResults.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

async function holdServerAction(page: Page, pathname: string) {
  let requestCaptured = false;
  let releaseRequest!: () => void;
  let resolveCaptured!: () => void;
  let resolveCompleted!: () => void;
  const captured = new Promise<void>((resolve) => {
    resolveCaptured = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve;
  });
  const routePattern = `**${pathname}*`;
  const handler = async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    if (
      route.request().method() !== "POST" ||
      requestUrl.pathname !== pathname ||
      requestCaptured
    ) {
      await route.continue();
      return;
    }
    requestCaptured = true;
    resolveCaptured();
    await released;
    try {
      await route.continue();
    } finally {
      resolveCompleted();
    }
  };

  await page.route(routePattern, handler);

  return {
    captured,
    async release() {
      releaseRequest();
      if (requestCaptured) await completed;
      await page.unroute(routePattern, handler);
    },
  };
}

test("staffのトップページをaxeで検査できる", async ({
  page,
  staff: _staff,
}) => {
  await page.goto("/clock");

  await expect(page.getByText("未勤務", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "昼に出勤" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日の勤怠" })).toBeVisible();

  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScanResults.violations).toEqual([]);
});

test("staffの登録済み勤怠閲覧画面をaxeで検査できる", async ({
  page,
  staff,
}) => {
  await staff.seedCompleted({
    workPeriod: "day",
    clockInAt: e2eTokyoDateAt(0, "09:00"),
    clockOutAt: e2eTokyoDateAt(0, "17:00"),
  });

  await page.goto("/clock");
  await expect(page.getByText(/09:00\s*→\s*17:00/)).toBeVisible();
  await expect(page.getByRole("button", { name: /勤怠を編集/ })).toHaveCount(0);

  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScanResults.violations).toEqual([]);
});

adminTest(
  "adminの勤怠履歴画面をaxeで検査できる",
  async ({ page, admin: _admin }) => {
    await page.goto("/admin");

    await adminExpect(page).toHaveURL(/\/admin\/attendance(?:\?.*)?$/);
    await adminExpect(
      page
        .getByRole("banner")
        .getByRole("heading", { name: "勤怠一覧", exact: true }),
    ).toBeVisible();
    await adminExpect(page.getByRole("button", { name: "検索" })).toBeEnabled();
    await adminExpect(
      page
        .getByRole("list", { name: "勤怠一覧" })
        .or(page.getByText("この期間の勤怠はありません。", { exact: true })),
    ).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    adminExpect(accessibilityScanResults.violations).toEqual([]);

    const navigation = page.getByRole("navigation", {
      name: "管理画面のメインナビゲーション",
    });
    await adminExpect(navigation).toBeVisible();
    const selectedItem = navigation.locator('[aria-current="page"]');
    await adminExpect(selectedItem).toHaveText("勤怠");
    await adminExpect(selectedItem).not.toHaveAttribute("href");
    await adminExpect(navigation.getByRole("link")).toHaveCount(2);
  },
);

adminTest("adminのユーザー画面をaxeで検査できる", async ({ page, admin }) => {
  await page.goto("/admin/users");

  await adminExpect(
    page.getByRole("heading", { name: "ユーザー一覧", exact: true }),
  ).toBeVisible();
  const adminRow = page
    .getByRole("list", { name: "管理者一覧" })
    .getByRole("listitem")
    .filter({ hasText: admin.displayName });
  await adminExpect(adminRow).toHaveCount(1);
  await adminExpect(adminRow).toBeVisible();

  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  adminExpect(accessibilityScanResults.violations).toEqual([]);
});

adminTest(
  "adminの給与一覧のデータなし状態をaxeで検査できる",
  async ({ page, admin: _admin }) => {
    await page.goto("/admin/payroll");

    const navigation = page.getByRole("group", {
      name: "給与一覧の月ナビゲーション",
    });
    await adminExpect(
      page
        .locator("header")
        .getByRole("heading", { name: "給与一覧", exact: true }),
    ).toBeVisible();
    await adminExpect(navigation).toBeVisible();
    await navigation.getByRole("button", { name: "月を直接選択" }).click();
    const monthInput = navigation.locator(
      'input[type="month"][aria-label="月を直接選択"]',
    );
    await adminExpect(monthInput).toBeVisible();
    await monthInput.fill("2099-01");
    await adminExpect(
      navigation.getByRole("heading", { name: "2099年1月", exact: true }),
    ).toBeVisible();
    await adminExpect(
      page.getByText("この月の勤怠データはありません", { exact: true }),
    ).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
    adminExpect(accessibilityScanResults.violations).toEqual([]);
  },
);

adminTest(
  "adminの給与一覧の読み込み中状態をaxeで検査できる",
  async ({ page, admin: _admin }) => {
    await page.goto("/admin/payroll");

    const navigation = page.getByRole("group", {
      name: "給与一覧の月ナビゲーション",
    });
    await adminExpect(
      page
        .locator("header")
        .getByRole("heading", { name: "給与一覧", exact: true }),
    ).toBeVisible();
    await adminExpect(navigation).toBeVisible();
    await navigation.getByRole("button", { name: "月を直接選択" }).click();
    const monthInput = navigation.locator(
      'input[type="month"][aria-label="月を直接選択"]',
    );
    await adminExpect(monthInput).toBeVisible();

    const pendingRequest = await holdServerAction(page, "/admin/payroll");
    try {
      await monthInput.fill("2099-02");
      await pendingRequest.captured;
      await adminExpect(
        navigation.getByRole("heading", { name: "2099年2月", exact: true }),
      ).toBeVisible();
      await adminExpect(
        page.getByText("給与一覧を読み込み中", { exact: true }),
      ).toBeVisible();

      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
      adminExpect(accessibilityScanResults.violations).toEqual([]);
    } finally {
      await pendingRequest.release();
    }

    await adminExpect(
      navigation.getByRole("heading", { name: "2099年2月", exact: true }),
    ).toBeVisible();
    await adminExpect(
      page.getByText("この月の勤怠データはありません", { exact: true }),
    ).toBeVisible();
  },
);

adminTest(
  "adminの給与一覧の金額表示をaxeで検査できる",
  async ({ page, admin: _admin }) => {
    const displayName = `E2Eアクセシビリティスタッフ-${randomUUID()}`;
    const staff = await createAuthenticatedUser({
      displayName,
      role: "staff",
      status: "active",
    });
    const attendanceId = randomUUID();
    const attendanceDate = "2026-01-15";
    const clockInAt = new Date("2026-01-15T09:00:00+09:00");
    const clockOutAt = new Date("2026-01-15T18:00:00+09:00");

    try {
      const [createdStaff] = await staff.db
        .select({
          id: users.id,
          displayName: users.displayName,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, staff.userId));
      adminExpect(createdStaff).toMatchObject({
        id: staff.userId,
        displayName,
        role: "staff",
        status: "active",
      });

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

      await adminExpect
        .poll(async () => {
          const [state] = await staff.db
            .select({ attendanceId: attendanceCurrentStates.attendanceId })
            .from(attendanceCurrentStates)
            .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
          const events = await staff.db
            .select({ eventVersion: attendanceEvents.eventVersion })
            .from(attendanceEvents)
            .where(eq(attendanceEvents.attendanceId, attendanceId));
          return {
            stateId: state?.attendanceId,
            eventVersions: events
              .map((event) => event.eventVersion)
              .sort((left, right) => left - right),
          };
        })
        .toEqual({
          stateId: attendanceId,
          eventVersions: [1, 2],
        });

      await page.goto("/admin/payroll");
      const navigation = page.getByRole("group", {
        name: "給与一覧の月ナビゲーション",
      });
      await adminExpect(
        page
          .locator("header")
          .getByRole("heading", { name: "給与一覧", exact: true }),
      ).toBeVisible();
      await adminExpect(navigation).toBeVisible();
      await navigation.getByRole("button", { name: "月を直接選択" }).click();
      const monthInput = navigation.locator(
        'input[type="month"][aria-label="月を直接選択"]',
      );
      await monthInput.fill("2026-01");
      const summaryList = page.getByRole("list", { name: "給与一覧" });
      await adminExpect(summaryList).toBeVisible();
      const staffRow = summaryList
        .getByRole("listitem")
        .filter({ hasText: displayName });
      await adminExpect(staffRow).toHaveCount(1);
      await adminExpect(staffRow).toBeVisible();
      await adminExpect(
        staffRow.getByRole("link", {
          name: `${displayName}の給与詳細へ移動`,
        }),
      ).toHaveAttribute(
        "href",
        `/admin/users/${staff.userId}/payroll?month=2026-01`,
      );

      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
      adminExpect(accessibilityScanResults.violations).toEqual([]);
    } finally {
      await staff.db
        .delete(attendanceCurrentStates)
        .where(eq(attendanceCurrentStates.attendanceId, attendanceId));
      await staff.db
        .delete(attendanceEvents)
        .where(eq(attendanceEvents.attendanceId, attendanceId));
      await staff.cleanup();
    }
  },
);

adminTest(
  "adminの時給設定の初期表示・読み込み中・読み込み完了後をaxeで検査できる",
  async ({ page, admin }) => {
    const pendingRequest = await holdServerAction(
      page,
      `/admin/users/${admin.userId}/hourly-wage-rates`,
    );
    try {
      await page.goto(`/admin/users/${admin.userId}/hourly-wage-rates`);
      await adminExpect(
        page.getByRole("heading", { name: "時給設定", exact: true }),
      ).toBeVisible();
      await adminExpect(
        page
          .getByRole("region", { name: "対象ユーザー" })
          .getByText(admin.displayName),
      ).toBeVisible();
      await adminExpect(
        page.getByRole("combobox", { name: "対象ユーザー" }),
      ).toHaveCount(0);
      await pendingRequest.captured;
      await adminExpect(
        page.getByRole("main").getByRole("status").filter({
          hasText: "時給一覧を読み込み中",
        }),
      ).toBeVisible();

      const loadingAccessibilityScanResults = await new AxeBuilder({
        page,
      }).analyze();
      adminExpect(loadingAccessibilityScanResults.violations).toEqual([]);
    } finally {
      await pendingRequest.release();
    }

    await adminExpect(
      page.getByRole("heading", { name: "時給一覧", exact: true }),
    ).toBeVisible();
    const wageTable = page.getByRole("table");
    await adminExpect(wageTable).toBeVisible();
    await adminExpect(
      wageTable.getByRole("columnheader", { name: "日区分", exact: true }),
    ).toBeVisible();
    const completedAccessibilityScanResults = await new AxeBuilder({
      page,
    }).analyze();
    adminExpect(completedAccessibilityScanResults.violations).toEqual([]);
  },
);

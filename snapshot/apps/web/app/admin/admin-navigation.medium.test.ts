import type { Page } from "@playwright/test";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";
import { TEST_REFERENCE_TIME_ISO } from "web/test-support/browser/reference-time";
import {
  expect as staffExpect,
  test as staffTest,
} from "web/test-support/browser/staff-fixture";

const adminNavigationLabel = "管理画面のメインナビゲーション";
const TEST_MONTH = TEST_REFERENCE_TIME_ISO.slice(0, 7);
const ADMIN_NAVIGATION_ITEMS = [
  ["勤怠", "/admin/attendance"],
  ["給与見込み", "/admin/payroll-estimates"],
  ["ユーザー", "/admin/users"],
] as const;

function adminNavigation(page: Page) {
  return page.getByRole("navigation", { name: adminNavigationLabel });
}

async function openAdminAttendanceSearch(page: Page) {
  const searchToggle = page.getByRole("button", {
    name: /検索条件を(開く|閉じる)/,
  });
  if ((await searchToggle.getAttribute("aria-expanded")) === "false") {
    await searchToggle.click();
  }
}

async function expectAdminAttendanceReady(page: Page) {
  await openAdminAttendanceSearch(page);
  await expect(
    page.getByRole("button", { name: "検索", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("list", { name: "勤怠一覧" })
      .or(page.getByText("この期間の勤怠はありません。", { exact: true })),
  ).toBeVisible();
  const createLink = page.getByRole("link", { name: "勤怠を新規作成" });
  await expect(createLink).toHaveAttribute("href", "/admin/attendance/new");
  await expect(createLink).toBeVisible();
  await expect(createLink).toHaveAttribute("href", "/admin/attendance/new");
}

async function expectActiveAdminNavigation(page: Page, label: string) {
  const navigation = adminNavigation(page);
  await expect(navigation).toBeVisible();
  const selected = navigation.locator('[aria-current="page"]');
  await expect(selected).toHaveText(label);
  await expect(selected).not.toHaveAttribute("href");
  await expect(navigation.getByRole("link")).toHaveCount(2);
  const expectedLinks = ADMIN_NAVIGATION_ITEMS.filter(
    ([name]) => name !== label,
  );
  for (const [index, [name, href]] of expectedLinks.entries()) {
    const link = navigation.getByRole("link").nth(index);
    await expect(link).toHaveText(name);
    await expect(link).toHaveAttribute("href", href);
  }
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  return navigation;
}

async function expectAdminPageShell(
  page: Page,
  heading: string,
): Promise<void> {
  if (heading === "勤怠一覧") await expectAdminAttendanceReady(page);
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);

  const selectedLabel =
    heading === "勤怠一覧" ||
    heading === "勤怠作成" ||
    heading === "勤怠詳細" ||
    heading === "勤怠訂正"
      ? "勤怠"
      : heading === "給与見込み一覧" || heading === "給与見込み詳細"
        ? "給与見込み"
        : "ユーザー";
  await expectActiveAdminNavigation(page, selectedLabel);
  await expect(page.getByRole("button", { name: "管理メニュー" })).toHaveCount(
    0,
  );
  await expect(page).toHaveTitle("TimeCard 管理画面");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "TimeCard", exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "給与見込みのサブナビゲーション" }),
  ).toHaveCount(0);
}

test("adminの常時表示タブから各領域へ遷移し、選択中は操作できない", async ({
  page,
  admin,
}) => {
  test.setTimeout(60_000);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/attendance(?:\?.*)?$/);
  await expectAdminPageShell(page, "勤怠一覧");
  for (const [label, href] of ADMIN_NAVIGATION_ITEMS.slice(1)) {
    await page.goto("/admin/attendance");
    const navigation = await expectActiveAdminNavigation(page, "勤怠");
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(href);
    await expectAdminPageShell(
      page,
      label === "給与見込み" ? "給与見込み一覧" : "ユーザー一覧",
    );
  }
  await page.goto("/admin/payroll-estimates");
  await expectAdminPageShell(page, "給与見込み一覧");
  await page.reload();
  await expectAdminPageShell(page, "給与見込み一覧");
  await expect(
    page.getByRole("group", { name: "給与見込み一覧の月ナビゲーション" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "時給設定", exact: true }),
  ).toHaveCount(0);
  await page.goto("/admin/users");
  await expectAdminPageShell(page, "ユーザー一覧");
  await expect(
    page.getByRole("heading", { name: "管理者", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "スタッフ", exact: true }),
  ).toBeVisible();
  const selfCard = page
    .getByRole("list", { name: "管理者一覧" })
    .getByRole("listitem")
    .filter({ hasText: admin.displayName });
  await expect(selfCard.getByRole("link")).toBeVisible();
  await page.goto("/admin/attendance/new");
  await expectAdminPageShell(page, "勤怠作成");
  await expect(page.locator("nav a")).toHaveCount(2);

  await page.goto(`/admin/users/${admin.userId}`);
  await expectAdminPageShell(page, "ユーザー詳細");
  await page.goto(`/admin/users/${admin.userId}/hourly-wage-rules`);
  await expectAdminPageShell(page, "時給設定");
  await page.goto(
    `/admin/users/${admin.userId}/payroll-estimates?month=${TEST_MONTH}`,
  );
  await expectAdminPageShell(page, "給与見込み詳細");
  await page.goto(`/admin/users/${admin.userId}/hourly-wage-rules/history`);
  await expectAdminPageShell(page, "時給履歴");
});

test("選択中の管理領域タブはリンクではない", async ({ page, admin }) => {
  void admin;
  await page.goto("/admin/attendance/new");
  const navigation = await expectActiveAdminNavigation(page, "勤怠");
  await expect(navigation.getByRole("link", { name: "勤怠" })).toHaveCount(0);
});

test("共有 layout 中の route 遷移で主体を切り替え、旧主体の編集 draft を残さない", async ({
  page,
  admin,
}) => {
  const nextAdmin = await createAuthenticatedUser({
    displayName: "E2E切替先管理者",
    role: "admin",
    status: "active",
  });
  try {
    await page.goto(`/admin/users/${admin.userId}`);
    const editButton = page.getByRole("button", { name: "表示名を編集" });
    await expect(editButton).toBeVisible();
    await editButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("textbox", { name: "表示名" }).fill("未保存の編集");

    await nextAdmin.setSessionCookie(page.context());
    await page
      .locator('a[href="/admin/payroll-estimates"]')
      .evaluate((link) => (link as HTMLAnchorElement).click());
    await expect(page).toHaveURL(/\/admin\/payroll-estimates(?:\?.*)?$/);
    await expectAdminPageShell(page, "給与見込み一覧");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("未保存の編集", { exact: true })).toHaveCount(
      0,
    );

    await adminNavigation(page).getByRole("link", { name: "ユーザー" }).click();
    await expect(page).toHaveURL("/admin/users");
    await expectAdminPageShell(page, "ユーザー一覧");
    await page.locator(`a[href="/admin/users/${nextAdmin.userId}"]`).click();
    await expect(page).toHaveURL(`/admin/users/${nextAdmin.userId}`);
    await expect(
      page.getByRole("heading", { name: "ユーザー詳細" }),
    ).toBeVisible();
    await expect(
      page.getByText("E2E切替先管理者", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await nextAdmin.cleanup();
  }
});

test("ユーザー詳細から時給設定と現在月の給与見込み詳細へ遷移できる", async ({
  page,
  admin,
}) => {
  test.setTimeout(60_000);
  const switchTargetName = "E2E時給切替対象";
  const switchTarget = await createAuthenticatedUser({
    displayName: switchTargetName,
    role: "staff",
    status: "active",
  });
  try {
    const usersPath = "/admin/users";
    await page.goto(usersPath);
    await expectAdminPageShell(page, "ユーザー一覧");
    const targetCard = page.locator(
      `a[href="/admin/users/${switchTarget.userId}"]`,
    );
    await targetCard.click();
    await page.waitForURL(`/admin/users/${switchTarget.userId}`);
    await expectAdminPageShell(page, "ユーザー詳細");
    await expect(
      page.getByRole("heading", { name: "基本情報", exact: true }),
    ).toBeVisible();
    const settingsPath = `/admin/users/${switchTarget.userId}/hourly-wage-rules`;
    await Promise.all([
      page.waitForURL(settingsPath),
      page.getByRole("link", { name: "時給設定" }).click(),
    ]);
    await expect(
      page
        .getByRole("region", { name: "対象ユーザー" })
        .getByText(switchTargetName),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "対象ユーザー" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("時給の適用期間")).toBeVisible();
    await page.goto(`/admin/users/${admin.userId}`);
    const payrollPath = `/admin/users/${admin.userId}/payroll-estimates?month=${TEST_MONTH}`;
    await Promise.all([
      page.waitForURL(payrollPath),
      page.getByRole("link", { name: "給与見込み詳細" }).click(),
    ]);
    await expectAdminPageShell(page, "給与見込み詳細");
  } finally {
    await switchTarget.cleanup();
  }
});

test("ユーザー固有の時給URLを再訪問し、履歴とブラウザ履歴から復元できる", async ({
  page,
  admin,
}) => {
  test.setTimeout(60_000);
  const settingsPath = `/admin/users/${admin.userId}/hourly-wage-rules`;
  const historyPath = `${settingsPath}/history`;

  await page.goto(settingsPath);
  await expect(page).toHaveURL(settingsPath);
  await expect(
    page
      .getByRole("region", { name: "対象ユーザー" })
      .getByText(admin.displayName),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "対象ユーザー" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(settingsPath);
  await expect(
    page
      .getByRole("region", { name: "対象ユーザー" })
      .getByText(admin.displayName),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "時給一覧", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();

  await Promise.all([
    page.waitForURL(historyPath),
    page.getByRole("link", { name: "時給履歴" }).click(),
  ]);
  await expect(page.getByRole("link", { name: "時給設定へ戻る" })).toHaveCount(
    0,
  );
  await page.goBack();
  await expect(page).toHaveURL(settingsPath);
  await expect(
    page
      .getByRole("region", { name: "対象ユーザー" })
      .getByText(admin.displayName),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(historyPath);
  await page.goBack();
  await expect(page).toHaveURL(settingsPath);
  await expect(
    page
      .getByRole("region", { name: "対象ユーザー" })
      .getByText(admin.displayName),
  ).toBeVisible();
});

test("給与見込み一覧の月ナビゲーションで前後移動と直接選択ができる", async ({
  page,
  admin,
}) => {
  void admin;
  await page.goto("/admin/payroll-estimates");
  const navigation = page.getByRole("group", {
    name: "給与見込み一覧の月ナビゲーション",
  });
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole("heading", {
      name: /^\d{4}年(?:[1-9]|1[0-2])月$/,
    }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "月を直接選択" }).click();
  const initialMonthInput = navigation.locator(
    'input[type="month"][aria-label="月を直接選択"]',
  );
  await initialMonthInput.fill(TEST_MONTH);
  await expect(
    navigation.getByRole("heading", { name: "2026年1月" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/admin/payroll-estimates?month=2026-01");

  const previous = navigation.getByRole("button", { name: "前の月" });
  const next = navigation.getByRole("button", { name: "次の月" });
  await previous.click();
  await expect(
    navigation.getByRole("heading", { name: "2025年12月" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/admin/payroll-estimates?month=2025-12");
  await next.click();
  await expect(
    navigation.getByRole("heading", { name: "2026年1月" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/admin/payroll-estimates?month=2026-01");

  await navigation.getByRole("button", { name: "月を直接選択" }).click();
  const monthInput = navigation.locator(
    'input[type="month"][aria-label="月を直接選択"]',
  );
  await expect(monthInput).toHaveValue("2026-01");
  await monthInput.fill("2026-02");
  await expect(
    navigation.getByRole("heading", { name: "2026年2月" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/admin/payroll-estimates?month=2026-02");
  await expect(monthInput).toBeHidden();
});

staffTest(
  "スタッフには管理画面の3タブを表示しない",
  async ({ page, staff }) => {
    void staff;
    await page.goto("/admin/attendance");
    await staffExpect(page).toHaveURL("/admin/attendance");
    await staffExpect(page.getByRole("status")).toHaveText(
      "このアカウントには管理権限がありません。",
    );
    await staffExpect(
      page.getByRole("button", { name: "管理メニュー" }),
    ).toHaveCount(0);
    await staffExpect(
      page.getByRole("navigation", { name: adminNavigationLabel }),
    ).toHaveCount(0);
  },
);

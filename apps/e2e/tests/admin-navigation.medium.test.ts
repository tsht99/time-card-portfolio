import type { Page } from "@playwright/test";

import { E2E_REFERENCE_TIME_ISO } from "../reference-time";
import { expect, test } from "./support/admin-fixture";
import { createAuthenticatedUser } from "./support/authenticated-user-fixture";
import {
  expect as staffExpect,
  test as staffTest,
} from "./support/staff-fixture";

const adminNavigationLabel = "管理画面のメインナビゲーション";
const E2E_MONTH = E2E_REFERENCE_TIME_ISO.slice(0, 7);
const ADMIN_VIEWPORT_WIDTHS = [320, 390, 768, 1280, 1920] as const;
const ADMIN_NAVIGATION_ITEMS = [
  ["勤怠", "/admin/attendance"],
  ["給与", "/admin/payroll"],
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
  const viewport = page.viewportSize();
  const linkBox = await createLink.boundingBox();
  if (!viewport || !linkBox)
    throw new Error("新規作成導線の寸法を取得できません。");
  expect(linkBox.x).toBeGreaterThanOrEqual(-1);
  expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(viewport.width + 1);
  const attendanceCards = page
    .getByRole("list", { name: "勤怠一覧" })
    .getByRole("link", { name: /勤怠詳細へ移動/ });
  if ((await attendanceCards.count()) > 0) {
    await createLink.scrollIntoViewIfNeeded();
    const lastCardBox = await attendanceCards.last().boundingBox();
    const creationLinkBox = await createLink.boundingBox();
    if (!lastCardBox || !creationLinkBox)
      throw new Error(
        "最後の勤怠カードまたは新規作成導線の寸法を取得できません。",
      );
    const overlaps =
      lastCardBox.x < creationLinkBox.x + creationLinkBox.width &&
      lastCardBox.x + lastCardBox.width > creationLinkBox.x &&
      lastCardBox.y < creationLinkBox.y + creationLinkBox.height &&
      lastCardBox.y + lastCardBox.height > creationLinkBox.y;
    expect(overlaps).toBe(false);
  }
  expect(
    await createLink.evaluate((link) => {
      const list = document.querySelector('[aria-label="勤怠一覧"] ul');
      return (
        !list ||
        Boolean(
          list.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
        )
      );
    }),
  ).toBe(true);
}

async function expectVisibleAdminControlsFitViewport(page: Page) {
  const overflowingElements = await page
    .locator(
      'main input:visible, main button:visible, main [role="button"]:visible, main [role="listitem"]:visible',
    )
    .evaluateAll((elements) => {
      const viewportWidth = document.documentElement.clientWidth;
      return elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > viewportWidth + 1;
        })
        .map((element) => element.tagName.toLowerCase());
    });
  expect(overflowingElements).toEqual([]);
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
      : heading === "給与一覧" || heading === "給与詳細"
        ? "給与"
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
    page.getByRole("navigation", { name: "給与のサブナビゲーション" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("adminの常時表示タブから各領域へ遷移し、選択中は操作できない", async ({
  page,
  admin,
}) => {
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
      label === "給与" ? "給与一覧" : "ユーザー一覧",
    );
  }
  await page.goto("/admin/payroll");
  await expectAdminPageShell(page, "給与一覧");
  await expect(
    page.getByRole("group", { name: "給与一覧の月ナビゲーション" }),
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
  await page.goto(`/admin/users/${admin.userId}/hourly-wage-rates`);
  await expectAdminPageShell(page, "時給設定");
  await page.goto(`/admin/users/${admin.userId}/payroll?month=${E2E_MONTH}`);
  await expectAdminPageShell(page, "給与詳細");
  await page.goto(`/admin/users/${admin.userId}/hourly-wage-rates/history`);
  await expectAdminPageShell(page, "時給履歴");
});

test("勤怠0件でも320px幅で空状態の後ろの導線から新規作成へ進める", async ({
  page,
  admin: _admin,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/attendance");
  await openAdminAttendanceSearch(page);
  await page.getByLabel("開始日").fill("2020-01-01");
  await page.getByLabel("終了日").fill("2020-01-31");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  const emptyState = page.getByText("この期間の勤怠はありません。", {
    exact: true,
  });
  await expect(emptyState).toBeVisible();
  const createLink = page.getByRole("link", { name: "勤怠を新規作成" });
  await expect(createLink).toHaveAttribute("href", "/admin/attendance/new");
  await expect(createLink).toBeVisible();
  expect(
    await createLink.evaluate((link) => {
      const region = link.closest('[aria-label="勤怠一覧"]');
      const message = Array.from(region?.querySelectorAll("p") ?? []).find(
        (paragraph) =>
          paragraph.textContent?.trim() === "この期間の勤怠はありません。",
      );
      if (!message) return false;
      const messageBox = message.getBoundingClientRect();
      const linkBox = link.getBoundingClientRect();
      return linkBox.top >= messageBox.bottom;
    }),
  ).toBe(true);
  await expectVisibleAdminControlsFitViewport(page);
  await createLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/admin/attendance/new");
});

test("選択中の管理領域タブはリンクではない", async ({
  page,
  admin: _admin,
}) => {
  await page.goto("/admin/attendance/new");
  const navigation = await expectActiveAdminNavigation(page, "勤怠");
  await expect(navigation.getByRole("link", { name: "勤怠" })).toHaveCount(0);
});

test("adminの主要画面は各viewportで横にはみ出さず操作できる", async ({
  page,
  admin,
}) => {
  test.setTimeout(120_000);
  const pages = [
    ["/admin/attendance", "勤怠一覧"],
    ["/admin/attendance/new", "勤怠作成"],
    ["/admin/payroll", "給与一覧"],
    ["/admin/users", "ユーザー一覧"],
    [`/admin/users/${admin.userId}`, "ユーザー詳細"],
    [`/admin/users/${admin.userId}/hourly-wage-rates`, "時給設定"],
    [`/admin/users/${admin.userId}/payroll?month=${E2E_MONTH}`, "給与詳細"],
    [`/admin/users/${admin.userId}/hourly-wage-rates/history`, "時給履歴"],
  ] as const;

  for (const width of ADMIN_VIEWPORT_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expectAdminPageShell(page, heading);
      const activeLabel =
        heading === "勤怠一覧" || heading === "勤怠作成"
          ? "勤怠"
          : heading === "給与一覧" || heading === "給与詳細"
            ? "給与"
            : "ユーザー";
      await expectActiveAdminNavigation(page, activeLabel);
      if (path === "/admin/attendance") {
        await openAdminAttendanceSearch(page);
        const period = page.getByRole("group", { name: "期間" });
        const from = page.getByLabel("開始日");
        const to = page.getByLabel("終了日");
        await expect(from).toBeVisible();
        await expect(to).toBeVisible();
        await expect(page.getByLabel("利用者")).toBeVisible();
        await expect(page.getByLabel("勤務区分")).toBeVisible();
        await expect(page.getByLabel("状態")).toBeVisible();
        await expect(
          page.getByRole("button", { name: "検索", exact: true }),
        ).toBeEnabled();
        await expect(period).toBeVisible();
      }
      if (path.endsWith("/hourly-wage-rates")) {
        await expect(
          page.getByRole("heading", { name: "時給一覧", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("table")).toBeVisible();
        await page.getByRole("button", { name: "時給を編集" }).click();
        await expect(page.getByLabel("適用開始日")).toBeVisible();
        await expect(page.getByRole("button", { name: "保存" })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "キャンセル" }),
        ).toBeVisible();
        await page.getByRole("button", { name: "キャンセル" }).click();
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await expectVisibleAdminControlsFitViewport(page);
    }
  }
});

test("ユーザー詳細から時給設定と現在月の給与詳細へ遷移できる", async ({
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
    const settingsPath = `/admin/users/${switchTarget.userId}/hourly-wage-rates`;
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
    const payrollPath = `/admin/users/${admin.userId}/payroll?month=${E2E_MONTH}`;
    await Promise.all([
      page.waitForURL(payrollPath),
      page.getByRole("link", { name: "給与詳細" }).click(),
    ]);
    await expectAdminPageShell(page, "給与詳細");
  } finally {
    await switchTarget.cleanup();
  }
});

test("ユーザー固有の時給URLを再訪問し、履歴とブラウザ履歴から復元できる", async ({
  page,
  admin,
}) => {
  test.setTimeout(60_000);
  const settingsPath = `/admin/users/${admin.userId}/hourly-wage-rates`;
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

test("給与一覧の月ナビゲーションで前後移動と直接選択ができる", async ({
  page,
  admin: _admin,
}) => {
  await page.goto("/admin/payroll");
  const navigation = page.getByRole("group", {
    name: "給与一覧の月ナビゲーション",
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
  await initialMonthInput.fill(E2E_MONTH);
  await expect(
    navigation.getByRole("heading", { name: "2026年1月" }),
  ).toBeVisible();

  const previous = navigation.getByRole("button", { name: "前の月" });
  const next = navigation.getByRole("button", { name: "次の月" });
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect(
    navigation.getByRole("heading", { name: "2025年12月" }),
  ).toBeVisible();
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(
    navigation.getByRole("heading", { name: "2026年1月" }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "月を直接選択" }).click();
  const monthInput = navigation.locator(
    'input[type="month"][aria-label="月を直接選択"]',
  );
  await expect(monthInput).toHaveValue("2026-01");
  await monthInput.fill("2026-02");
  await expect(
    navigation.getByRole("heading", { name: "2026年2月" }),
  ).toBeVisible();
  await expect(monthInput).toBeHidden();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(navigation).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});

staffTest(
  "スタッフには管理画面の3タブを表示しない",
  async ({ page, staff: _staff }) => {
    await page.goto("/admin/attendance");
    await staffExpect(page).toHaveURL("/admin/attendance");
    await staffExpect(
      page.getByText("このアカウントには管理権限がありません。", {
        exact: true,
      }),
    ).toBeVisible();
    await staffExpect(
      page.getByRole("button", { name: "管理メニュー" }),
    ).toHaveCount(0);
    await staffExpect(
      page.getByRole("navigation", { name: adminNavigationLabel }),
    ).toHaveCount(0);
  },
);

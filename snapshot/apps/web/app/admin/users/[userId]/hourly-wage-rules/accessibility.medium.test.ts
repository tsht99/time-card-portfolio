import AxeBuilder from "@axe-core/playwright";

import {
  expect as adminExpect,
  test as adminTest,
} from "web/test-support/browser/admin-fixture";

adminTest(
  "adminの時給設定をSSRで初期表示しaxeで検査できる",
  async ({ page, admin }) => {
    await page.goto(`/admin/users/${admin.userId}/hourly-wage-rules`);
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

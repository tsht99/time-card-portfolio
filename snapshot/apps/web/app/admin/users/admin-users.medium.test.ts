import { randomUUID } from "node:crypto";

import { users } from "@repo/db";
import { eq } from "drizzle-orm";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { assertAdminRouteReadiness } from "web/test-support/browser/admin-route-readiness";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";

test("adminがactiveなstaffをinactiveに変更できる", async ({ page, admin }) => {
  void admin;
  const staff = await createAuthenticatedUser({
    displayName: "E2E状態変更スタッフ",
    role: "staff",
    status: "active",
  });

  try {
    await page.goto("/admin/users");

    await expect(
      page.getByRole("heading", { name: "ユーザー一覧" }),
    ).toBeVisible();
    const staffCard = page
      .getByRole("listitem")
      .filter({ hasText: "E2E状態変更スタッフ" });
    await expect(staffCard).toContainText("利用中");
    await expect(
      staffCard.getByRole("link", { name: /E2E状態変更スタッフ/ }),
    ).toHaveAttribute("href", `/admin/users/${staff.userId}`);

    await staffCard.getByRole("link").click();
    const initialReadiness = await assertAdminRouteReadiness(page);
    await expect(
      page.getByRole("button", { name: "利用を停止する" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "利用を停止する" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "利用を停止する" })
      .click();
    await assertAdminRouteReadiness(
      page,
      initialReadiness.routeDataToken ?? undefined,
    );
    await expect(page.getByRole("dialog")).toBeHidden();

    await expect
      .poll(async () => {
        const rows = await staff.db
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, staff.userId));
        return rows[0]?.status;
      })
      .toBe("inactive");

    const statusRow = page.getByText("利用状態", { exact: true }).locator("..");
    await expect(
      statusRow.getByText("利用停止", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("再有効化する")).toBeVisible();
  } finally {
    await staff.cleanup();
  }
});

test("admin本人の表示名をユーザー画面から変更できる", async ({
  page,
  admin,
}) => {
  const otherAdminDisplayName = `E2E別管理者-${randomUUID()}`;
  const otherAdmin = await createAuthenticatedUser({
    displayName: otherAdminDisplayName,
    role: "admin",
    status: "active",
  });
  const nextDisplayName = `E2E更新管理者-${randomUUID()}`;

  try {
    const currentAdminDisplayName = (
      await otherAdmin.db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, admin.userId))
    )[0]?.displayName;
    await page.goto("/admin/users");

    await expect(
      page.getByRole("heading", { name: "ユーザー一覧" }),
    ).toBeVisible();
    const adminList = page.getByRole("list", { name: "管理者一覧" });
    const selfCard = adminList
      .getByRole("listitem")
      .filter({ hasText: currentAdminDisplayName ?? "" });
    const otherCard = adminList
      .getByRole("listitem")
      .filter({ hasText: otherAdminDisplayName });

    await expect(selfCard).toContainText(currentAdminDisplayName ?? "");
    await expect(selfCard.getByRole("link")).toHaveAttribute(
      "href",
      `/admin/users/${admin.userId}`,
    );
    await expect(otherCard.getByRole("link")).toHaveAttribute(
      "href",
      `/admin/users/${otherAdmin.userId}`,
    );

    await selfCard.getByRole("link").click();
    const initialReadiness = await assertAdminRouteReadiness(page);
    await expect(
      page.getByRole("button", { name: "表示名を編集" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "表示名を編集" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("textbox", { name: "表示名" }).fill(nextDisplayName);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存" })
      .click();
    await assertAdminRouteReadiness(
      page,
      initialReadiness.routeDataToken ?? undefined,
    );

    await expect
      .poll(async () => {
        const rows = await otherAdmin.db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(eq(users.id, admin.userId));
        return rows[0];
      })
      .toEqual({ id: admin.userId, displayName: nextDisplayName });

    await page.reload();
    await expect(
      page.getByRole("button", { name: "表示名を編集" }),
    ).toBeVisible();
    await expect(
      page.getByText(nextDisplayName, { exact: true }),
    ).toBeVisible();

    await page.goto("/admin/users");
    const reloadedAdminList = page.getByRole("list", { name: "管理者一覧" });
    const reloadedSelfCard = reloadedAdminList
      .getByRole("listitem")
      .filter({ hasText: nextDisplayName });
    await expect(reloadedSelfCard).toContainText(nextDisplayName);
    await expect(reloadedSelfCard.getByRole("link")).toHaveAttribute(
      "href",
      `/admin/users/${admin.userId}`,
    );
    await expect(
      reloadedAdminList
        .getByRole("listitem")
        .filter({ hasText: otherAdminDisplayName })
        .getByText(otherAdminDisplayName),
    ).toBeVisible();
    await expect(
      reloadedAdminList
        .getByRole("listitem")
        .filter({ hasText: otherAdminDisplayName })
        .getByRole("button"),
    ).toHaveCount(0);
  } finally {
    await otherAdmin.cleanup();
  }
});

test("表示名は100コードポイントまで保存でき、101文字は拒否する", async ({
  page,
  admin,
}) => {
  void admin;
  const staff = await createAuthenticatedUser({
    displayName: "初期待ち",
    role: "staff",
    status: "pending",
  });
  const validName = "😀".repeat(100);
  try {
    await staff.db
      .update(users)
      .set({ displayName: null })
      .where(eq(users.id, staff.userId));
    await page.goto(`/admin/users/${staff.userId}`);
    await assertAdminRouteReadiness(page);
    await page.getByRole("button", { name: "表示名を編集" }).click();
    const input = page.getByRole("textbox", { name: "表示名" });
    await input.fill("😀".repeat(101));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存" })
      .click();
    await expect(page.getByRole("alert")).toHaveText(
      "表示名は100文字以内で入力してください。",
    );
    const [unchanged] = await staff.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, staff.userId));
    expect(unchanged?.displayName).toBeNull();

    await input.fill(validName);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存" })
      .click();
    await expect
      .poll(async () => {
        const [row] = await staff.db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, staff.userId));
        return row?.displayName;
      })
      .toBe(validName);

    await page.reload();
    await expect(page.getByText(validName, { exact: true })).toBeVisible();
    await page.screenshot({
      path: "/tmp/timecard-display-name-100.png",
      fullPage: true,
    });
  } finally {
    await staff.cleanup();
  }
});

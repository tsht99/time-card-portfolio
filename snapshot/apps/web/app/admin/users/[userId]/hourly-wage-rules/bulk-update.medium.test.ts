import { hourlyWageRules } from "@repo/db";
import { eq } from "drizzle-orm";
import { expect, test } from "web/test-support/browser/admin-fixture";
import { createAuthenticatedUser } from "web/test-support/browser/authenticated-user-fixture";

test("adminが曜日別・昼夜別の時給を一括更新して再読み込み後も確認できる", async ({
  page,
  admin,
}) => {
  void admin;
  const staff = await createAuthenticatedUser({
    displayName: "E2E一括時給スタッフ",
    role: "staff",
    status: "active",
  });

  try {
    await staff.db.insert(hourlyWageRules).values([
      {
        userId: staff.userId,
        workPeriod: "day",
        dayType: "mon",
        hourlyWage: 1200,
        effectiveFrom: "2026-01-01",
      },
      {
        userId: staff.userId,
        workPeriod: "day",
        dayType: "tue",
        hourlyWage: 1250,
        effectiveFrom: "2026-01-01",
      },
    ]);

    await page.goto(`/admin/users/${staff.userId}/hourly-wage-rules`);
    const wageTable = page.getByRole("table");
    await expect(
      page.getByRole("heading", { name: "時給設定", exact: true }),
    ).toBeVisible();
    await expect(
      wageTable.getByRole("row").filter({ hasText: "月" }),
    ).toContainText("1,200円");
    await expect(
      wageTable.getByRole("row").filter({ hasText: "火" }),
    ).toContainText("1,250円");

    await page.getByRole("button", { name: "時給を編集" }).click();
    await expect(page.getByLabel("適用開始日")).toHaveValue("2026-01-01");
    await page.getByLabel("月 昼の変更時給").fill("1500");
    await page.getByLabel("月 夜の変更時給").fill("1600");
    await page.getByRole("button", { name: "保存", exact: true }).click();

    await expect(page.getByRole("status")).toHaveText("時給を更新しました。");
    await expect
      .poll(async () => {
        const rows = await staff.db
          .select({
            dayType: hourlyWageRules.dayType,
            workPeriod: hourlyWageRules.workPeriod,
            hourlyWage: hourlyWageRules.hourlyWage,
            effectiveFrom: hourlyWageRules.effectiveFrom,
          })
          .from(hourlyWageRules)
          .where(eq(hourlyWageRules.userId, staff.userId));
        return rows
          .map(({ dayType, workPeriod, hourlyWage, effectiveFrom }) => ({
            dayType,
            workPeriod,
            hourlyWage,
            effectiveFrom,
          }))
          .sort((left, right) =>
            `${left.dayType}:${left.workPeriod}`.localeCompare(
              `${right.dayType}:${right.workPeriod}`,
            ),
          );
      })
      .toEqual([
        {
          dayType: "mon",
          workPeriod: "day",
          hourlyWage: 1500,
          effectiveFrom: "2026-01-01",
        },
        {
          dayType: "mon",
          workPeriod: "night",
          hourlyWage: 1600,
          effectiveFrom: "2026-01-01",
        },
        {
          dayType: "tue",
          workPeriod: "day",
          hourlyWage: 1250,
          effectiveFrom: "2026-01-01",
        },
      ]);

    await page.reload();
    const reloadedTable = page.getByRole("table");
    await expect(
      reloadedTable.getByRole("row").filter({ hasText: "月" }),
    ).toContainText("1,500円");
    await expect(
      reloadedTable.getByRole("row").filter({ hasText: "月" }),
    ).toContainText("1,600円");
    await expect(
      reloadedTable.getByRole("row").filter({ hasText: "火" }),
    ).toContainText("1,250円");
  } finally {
    await staff.cleanup();
  }
});

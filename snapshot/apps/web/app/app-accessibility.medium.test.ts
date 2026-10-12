import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "web/test-support/browser/staff-fixture";

test("存在しないURLは日本語の404画面を返しアクセシビリティ違反がない", async ({
  page,
  staff,
}) => {
  void staff;
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

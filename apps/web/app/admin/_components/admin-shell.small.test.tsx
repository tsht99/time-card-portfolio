import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/attendance" }));
vi.mock("./auth-provider.tsx", () => ({
  useAuth: () => ({ authState: { status: "ready" } }),
}));

afterEach(cleanup);

test("認証済み画面では3タブを常時表示し、選択項目はリンクにしない", async () => {
  const { AdminShell } = await import("./admin-shell.tsx");
  render(<AdminShell>内容</AdminShell>);

  const navigation = screen.getByRole("navigation", {
    name: "管理画面のメインナビゲーション",
  });
  expect(
    within(navigation).getByText("勤怠").getAttribute("aria-current"),
  ).toBe("page");
  expect(within(navigation).queryByRole("link", { name: "勤怠" })).toBeNull();
  expect(
    within(navigation)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["給与", "/admin/payroll"],
    ["ユーザー", "/admin/users"],
  ]);
  expect(screen.getByRole("heading", { name: "勤怠一覧" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "管理メニュー" })).toBeNull();
});

test("管理ナビゲーションをページタイトルより前に表示する", async () => {
  const { AdminShell } = await import("./admin-shell.tsx");
  render(<AdminShell>内容</AdminShell>);

  const navigation = screen.getByRole("navigation", {
    name: "管理画面のメインナビゲーション",
  });
  const heading = screen.getByRole("heading", {
    name: "勤怠一覧",
  });
  expect(
    navigation.compareDocumentPosition(heading) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("内容")).toBeTruthy();
});

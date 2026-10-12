import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AdminShellView } from "./admin-shell-view";

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/attendance" }));
vi.mock("./auth-provider.tsx", () => ({
  useAuth: mockUseAuth,
}));

afterEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

function authState(status: string, userId = "admin-1") {
  return {
    authState:
      status === "ready"
        ? { status, user: { userId } }
        : { status, message: "認証できません。" },
    serverSubjectUserId: "admin-1",
    isSubjectCurrent: status === "ready" && userId === "admin-1",
    refreshFailure: null,
  };
}

test("認証済み画面では3タブを常時表示し、選択項目はリンクにしない", async () => {
  mockUseAuth.mockReturnValue(authState("ready"));
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
    ["給与見込み", "/admin/payroll-estimates"],
    ["ユーザー", "/admin/users"],
  ]);
  expect(screen.getByRole("heading", { name: "勤怠一覧" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "管理メニュー" })).toBeNull();
});

test("server data refresh failure hides admin actions and reloads only on explicit click", async () => {
  const onReload = vi.fn();
  render(
    <AdminShellView
      pathname="/admin/attendance"
      isAuthReady={false}
      authMessage="認証後の最新データを確認できませんでした。入力中の内容が失われる可能性があります。ページを再読み込みしてください。"
      reloadRequired
      onReload={onReload}
    >
      内容
    </AdminShellView>,
  );

  expect(
    screen.queryByRole("navigation", {
      name: "管理画面のメインナビゲーション",
    }),
  ).toBeNull();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe(
    "最新のデータを取得できませんでした。ページを再読み込みしてください。再読み込みすると、未保存の入力内容が失われる可能性があります。",
  );
  expect(
    screen.getAllByText(
      "再読み込みすると、未保存の入力内容が失われる可能性があります。",
    ),
  ).toHaveLength(1);
  expect(onReload).not.toHaveBeenCalled();
  const reloadButton = screen.getByRole("button", {
    name: "ページを再読み込み",
  });
  expect(reloadButton.className).toContain("bg-primary");
  reloadButton.click();
  expect(onReload).toHaveBeenCalledOnce();
});

test("管理ナビゲーションをページタイトルより前に表示する", async () => {
  mockUseAuth.mockReturnValue(authState("ready"));
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

test.each(["checking", "unavailable", "error"])(
  "%s 状態では管理ナビゲーションと共通ヘッダーを表示しない",
  async (status) => {
    mockUseAuth.mockReturnValue(authState(status));
    const { AdminShell } = await import("./admin-shell.tsx");
    render(<AdminShell>内容</AdminShell>);

    expect(
      screen.queryByRole("navigation", {
        name: "管理画面のメインナビゲーション",
      }),
    ).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("認証できません。");
    expect(screen.getByText("内容").closest("[hidden]")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "利用者ガイド ↗" })).toBeNull();
  },
);

test("ready admin screens show a guide link for the current route", async () => {
  mockUseAuth.mockReturnValue(authState("ready"));
  const { AdminShell } = await import("./admin-shell.tsx");
  render(<AdminShell>内容</AdminShell>);
  const guide = screen.getByRole("link", { name: "利用者ガイド ↗" });
  const content = screen.getByText("内容");
  const surface = content.closest(".border-zinc-300.bg-surface");
  expect(surface).not.toBeNull();
  expect(surface?.classList.contains("flex")).toBe(true);
  expect(surface?.classList.contains("flex-col")).toBe(true);
  expect(surface?.contains(guide)).toBe(true);
  const relatedInfo = screen.getByRole("complementary", { name: "関連情報" });
  expect(relatedInfo.classList.contains("mt-auto")).toBe(true);
  expect(guide.getAttribute("href")).toBe(
    "https://help.example.test/admin/attendance",
  );
  expect(guide.getAttribute("target")).toBe("_blank");
  expect(guide.getAttribute("rel")).toBe("noopener noreferrer");
});

test("server session と client auth の主体が異なる間は以前の画面データを隠す", async () => {
  mockUseAuth.mockReturnValue(authState("ready", "admin-2"));
  const { AdminShell } = await import("./admin-shell.tsx");
  render(<AdminShell>admin-1 の画面データ</AdminShell>);

  expect(screen.getByRole("status").textContent).toBe(
    "認証状態を更新しています...",
  );
  expect(
    screen.getByText("admin-1 の画面データ").closest("[hidden]"),
  ).not.toBeNull();
  expect(
    screen.queryByRole("navigation", {
      name: "管理画面のメインナビゲーション",
    }),
  ).toBeNull();
});

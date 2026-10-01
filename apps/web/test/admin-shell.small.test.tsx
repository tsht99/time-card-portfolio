import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/attendance" }));
vi.mock("../app/admin/_components/auth-provider.tsx", () => ({
  useAuth: mockUseAuth,
}));

afterEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

test.each(["checking", "unavailable", "error"])(
  "%s 状態では管理ナビゲーションと共通ヘッダーを表示しない",
  async (status) => {
    mockUseAuth.mockReturnValue({ authState: { status } });
    const { AdminShell } = await import(
      "../app/admin/_components/admin-shell.tsx"
    );
    render(<AdminShell>内容</AdminShell>);

    expect(
      screen.queryByRole("navigation", {
        name: "管理画面のメインナビゲーション",
      }),
    ).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByText("内容")).toBeTruthy();
  },
);

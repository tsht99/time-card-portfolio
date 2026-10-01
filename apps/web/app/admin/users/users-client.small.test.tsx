import type { UserListItem } from "@repo/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: {
      status: "ready",
      user: {
        userId: "admin-1",
        displayName: "管理者",
        role: "admin",
        status: "active",
      },
    },
  }),
}));

const users: UserListItem[] = [
  {
    userId: "staff-inactive",
    displayName: "停止中スタッフ",
    role: "staff" as const,
    status: "inactive" as const,
  },
  {
    userId: "staff-active-z",
    displayName: "同じ状態のスタッフ後",
    role: "staff" as const,
    status: "active" as const,
  },
  {
    userId: "admin-2",
    displayName: "管理者2",
    role: "admin" as const,
    status: "active" as const,
  },
  {
    userId: "staff-pending",
    displayName: null,
    role: "staff" as const,
    status: "pending" as const,
  },
  {
    userId: "admin-1",
    displayName: "管理者1",
    role: "admin" as const,
    status: "active" as const,
  },
  {
    userId: "staff-active-a",
    displayName: "同じ状態のスタッフ先",
    role: "staff" as const,
    status: "active" as const,
  },
];

async function renderClient(data = users) {
  const { UsersClient } = await import("./users-client");
  render(<UsersClient initialUsers={{ status: "ready", data }} />);
}

afterEach(() => cleanup());

describe("UsersClient", () => {
  test("管理者とスタッフを1人1行で分け、詳細Linkと利用状態を表示する", async () => {
    await renderClient();

    const admins = screen.getByRole("list", { name: "管理者一覧" });
    const staff = screen.getByRole("list", { name: "スタッフ一覧" });
    expect(within(admins).getAllByRole("listitem")).toHaveLength(2);
    expect(within(staff).getAllByRole("listitem")).toHaveLength(4);
    expect(within(admins).getAllByRole("link")).toHaveLength(2);
    expect(within(staff).getAllByRole("link")).toHaveLength(4);
    expect(screen.getByText("名前未設定")).toBeTruthy();
    expect(screen.getAllByText("利用中")).toHaveLength(4);
    expect(screen.getByText("承認待ち")).toBeTruthy();
    expect(screen.getByText("利用停止")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("スタッフはstatus順、同status内と管理者はuserId順で安定して並ぶ", async () => {
    await renderClient();

    const staffLinks = within(
      screen.getByRole("list", { name: "スタッフ一覧" }),
    ).getAllByRole("link");
    expect(staffLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/admin/users/staff-active-a",
      "/admin/users/staff-active-z",
      "/admin/users/staff-pending",
      "/admin/users/staff-inactive",
    ]);
    expect(
      within(screen.getByRole("list", { name: "管理者一覧" }))
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/admin/users/admin-1", "/admin/users/admin-2"]);
  });

  test("長い表示名はaccessibleな詳細リンク名に含まれる", async () => {
    await renderClient([
      {
        userId: "long-name",
        displayName: "非常に長い表示名のスタッフ",
        role: "staff",
        status: "active",
      },
    ]);

    const link = screen.getByRole("link", {
      name: /非常に長い表示名のスタッフ/,
    });
    expect(link.getAttribute("href")).toBe("/admin/users/long-name");
    expect(link.contains(screen.getByText("非常に長い表示名のスタッフ"))).toBe(
      true,
    );
    expect(link.contains(screen.getByText("利用中"))).toBe(true);
    expect(link.getAttribute("aria-label") ?? link.textContent).toContain(
      "非常に長い表示名のスタッフ",
    );
  });

  test("スタッフが0件なら空状態を表示する", async () => {
    await renderClient([
      {
        userId: "admin-1",
        displayName: "管理者",
        role: "admin",
        status: "active",
      },
    ]);

    expect(screen.getByText("管理対象のスタッフはいません。")).toBeTruthy();
    expect(screen.getByRole("list", { name: "管理者一覧" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "スタッフ一覧" })).toBeNull();
  });
});

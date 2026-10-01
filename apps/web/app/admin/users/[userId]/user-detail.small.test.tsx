import type { UserListItem } from "@repo/contracts";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AdminUsersState } from "../../../../lib/admin-user-management-types";

type TestAuthState = {
  status: string;
  user?: {
    userId: string;
    displayName: string;
    role: "admin" | "staff";
    status: "active" | "inactive" | "pending";
  };
  message?: string;
};

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  reauthenticate: vi.fn(async () => undefined),
  updateDisplayName: vi.fn(),
  updateStatus: vi.fn(),
  authState: {
    status: "ready",
    user: {
      userId: "admin-1",
      displayName: "管理者本人",
      role: "admin" as const,
      status: "active" as const,
    },
  } as TestAuthState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: mocks.authState,
    reauthenticate: mocks.reauthenticate,
  }),
}));
vi.mock("../../_actions/user-management-actions.ts", () => ({
  updateAdminUserDisplayNameAction: mocks.updateDisplayName,
  updateAdminUserStatusAction: mocks.updateStatus,
}));

const staff = {
  userId: "staff-1",
  displayName: "対象スタッフ",
  role: "staff" as const,
  status: "active" as const,
};

function stateFor(user: UserListItem = staff): AdminUsersState {
  return { status: "ready" as const, data: [user] };
}

async function renderDetail(
  initialUsers: AdminUsersState = stateFor(),
  userId = staff.userId,
) {
  const { UserDetail } = await import("./user-detail");
  const { QueryProvider } = await import(
    "../../_components/query-provider.tsx"
  );
  return render(
    <QueryProvider>
      <UserDetail
        initialUsers={initialUsers}
        userId={userId}
        currentMonth="2026-09"
      />
    </QueryProvider>,
  );
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.reauthenticate.mockReset().mockResolvedValue(undefined);
  mocks.updateDisplayName.mockReset();
  mocks.updateStatus.mockReset();
  mocks.authState = {
    status: "ready",
    user: {
      userId: "admin-1",
      displayName: "管理者本人",
      role: "admin",
      status: "active",
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UserDetail", () => {
  test("基本情報の下に現在月を含むユーザー固有の導線を表示する", async () => {
    await renderDetail();

    expect(screen.getByRole("heading", { name: "基本情報" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "時給設定" }).getAttribute("href"),
    ).toBe("/admin/users/staff-1/hourly-wage-rates");
    expect(
      screen.getByRole("link", { name: "給与詳細" }).getAttribute("href"),
    ).toBe("/admin/users/staff-1/payroll?month=2026-09");
  });

  test("スタッフは表示名カードと権限・利用状態を表示する", async () => {
    await renderDetail();

    expect(screen.getByText("対象スタッフ")).toBeTruthy();
    expect(screen.getAllByText("対象スタッフ")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "対象ユーザー" })).toBeTruthy();
    expect(screen.queryByText("対象ユーザー:")).toBeNull();
    expect(screen.queryByText("表示名", { selector: "dt" })).toBeNull();
    expect(screen.getByText("スタッフ")).toBeTruthy();
    expect(screen.getByText("利用中")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "表示名を編集" }).textContent,
    ).toBe("");
    expect(
      screen.getByRole("button", { name: "利用を停止する" }).textContent,
    ).toBe("");

    expect(
      screen
        .getByRole("button", { name: "表示名を編集" })
        .querySelector("svg")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  test("表示名未設定を表示し、adminは本人だけ編集できる", async () => {
    await renderDetail(stateFor({ ...staff, displayName: null }));
    expect(screen.getByText("名前未設定")).toBeTruthy();
    expect(screen.getByRole("button", { name: "表示名を編集" })).toBeTruthy();
    cleanup();

    await renderDetail(
      stateFor({
        userId: "admin-1",
        displayName: "管理者本人",
        role: "admin",
        status: "active",
      }),
      "admin-1",
    );
    expect(screen.getByRole("button", { name: "表示名を編集" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "利用を停止する" })).toBeNull();
    cleanup();

    await renderDetail(
      stateFor({
        userId: "admin-2",
        displayName: "別管理者",
        role: "admin",
        status: "active",
      }),
      "admin-2",
    );
    expect(screen.queryByRole("button", { name: "表示名を編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "利用を停止する" })).toBeNull();
  });

  test.each([
    ["pending", "承認する", "承認待ち", "利用中"],
    ["active", "利用を停止する", "利用中", "利用停止"],
    ["inactive", "再有効化する", "利用停止", "利用中"],
  ] as const)(
    "%s は対応する状態アイコンと次状態を持つ",
    async (status, action, current, next) => {
      await renderDetail(stateFor({ ...staff, status }));
      expect(screen.getByText(current)).toBeTruthy();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: action }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getAllByText("対象スタッフ")).toHaveLength(2);
      expect(within(dialog).getByText(current)).toBeTruthy();
      expect(
        within(dialog).getByText("変更後の状態").nextElementSibling
          ?.textContent,
      ).toBe(next);
      expect(within(dialog).getByRole("button", { name: action })).toBeTruthy();
    },
  );

  test("表示名編集は初期値をtrimして保存し、空白を拒否し、キャンセルする", async () => {
    const user = userEvent.setup();
    mocks.updateDisplayName.mockResolvedValue({ success: true });
    await renderDetail();

    await user.click(screen.getByRole("button", { name: "表示名を編集" }));
    const input = screen.getByLabelText("表示名") as HTMLInputElement;
    expect(input.value).toBe("対象スタッフ");
    await user.clear(input);
    await user.type(input, "  更新後  ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith({
        userId: "staff-1",
        displayName: "更新後",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "表示名を編集" }));
    await user.clear(screen.getByLabelText("表示名"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("表示名を入力してください。")).toBeTruthy();
    expect(mocks.updateDisplayName).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText("表示名"), "😀".repeat(101));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      screen.getByText("表示名は100文字以内で入力してください。"),
    ).toBeTruthy();
    expect(mocks.updateDisplayName).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("表示名の競合失敗後に再試行でき、未設定admin本人も編集できる", async () => {
    const user = userEvent.setup();
    mocks.updateDisplayName
      .mockResolvedValueOnce({
        success: false,
        code: "USER_DISPLAY_NAME_CONFLICT",
        message: "表示名が競合しています。",
      })
      .mockResolvedValueOnce({ success: true });
    await renderDetail();

    await user.click(screen.getByRole("button", { name: "表示名を編集" }));
    const input = screen.getByLabelText("表示名");
    await user.clear(input);
    await user.type(input, "新しい名前");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("表示名が競合しています。")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledTimes(2),
    );

    cleanup();
    await renderDetail(
      stateFor({
        userId: "admin-1",
        displayName: null,
        role: "admin",
        status: "active",
      }),
      "admin-1",
    );
    expect(screen.getByRole("button", { name: "表示名を編集" })).toBeTruthy();
  });

  test("状態変更は確認前・キャンセル時にActionを呼ばず、確定時だけ次状態を渡す", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    mocks.updateStatus.mockResolvedValue({ success: true });
    await renderDetail();

    await user.click(screen.getByRole("button", { name: "利用を停止する" }));
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "キャンセル",
      }),
    );
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "利用を停止する" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "利用を停止する",
      }),
    );
    await waitFor(() =>
      expect(mocks.updateStatus).toHaveBeenCalledWith({
        userId: "staff-1",
        status: "inactive",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("SESSION_EXPIREDだけ再認証して1回retryし、その他の失敗はDialogを維持する", async () => {
    const user = userEvent.setup();
    mocks.updateStatus
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      })
      .mockResolvedValueOnce({ success: true });
    await renderDetail();
    await user.click(screen.getByRole("button", { name: "利用を停止する" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "利用を停止する",
      }),
    );
    await waitFor(() => expect(mocks.updateStatus).toHaveBeenCalledTimes(2));
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    cleanup();
    mocks.updateStatus.mockResolvedValue({
      success: false,
      code: "USER_STATUS_TRANSITION_FORBIDDEN",
      message: "この利用状態への変更はできません。",
    });
    await renderDetail();
    await user.click(screen.getByRole("button", { name: "利用を停止する" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "利用を停止する",
      }),
    );
    expect(
      await screen.findByText("この利用状態への変更はできません。"),
    ).toBeTruthy();
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("対象不在、取得失敗、認証中・認証失敗では業務情報と操作を表示しない", async () => {
    await renderDetail({ status: "ready", data: [] });
    expect(screen.getByText("ユーザーが見つかりません。")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region", { name: "関連ページ" })).toBeNull();
    cleanup();

    await renderDetail({
      status: "missing",
      message: "ログイン状態が切れています。",
    });
    expect(screen.getByText("ログイン状態が切れています。")).toBeTruthy();
    expect(screen.queryByText("対象スタッフ")).toBeNull();
    expect(screen.queryByRole("region", { name: "関連ページ" })).toBeNull();
    cleanup();

    await renderDetail({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "管理権限がありません。",
    });
    expect(screen.getByText("管理権限がありません。")).toBeTruthy();
    expect(screen.queryByText("対象スタッフ")).toBeNull();
    cleanup();

    await renderDetail({
      status: "error",
      message: "ユーザー一覧を取得できませんでした。",
    });
    expect(
      screen.getByText("ユーザー一覧を取得できませんでした。"),
    ).toBeTruthy();
    expect(screen.queryByText("対象スタッフ")).toBeNull();
    cleanup();

    for (const authState of [
      { status: "checking", message: "管理画面を準備しています..." },
      { status: "unavailable", message: "管理権限がありません。" },
      { status: "error", message: "認証に失敗しました。" },
    ]) {
      mocks.authState = authState;
      await renderDetail();
      expect(screen.getByText(authState.message)).toBeTruthy();
      expect(screen.queryByRole("region", { name: "関連ページ" })).toBeNull();
      expect(screen.queryByText("対象スタッフ")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      cleanup();
    }
  });

  test("ユーザー切替時に前のDialogと入力値を引き継がない", async () => {
    const user = userEvent.setup();
    const { UserDetail } = await import("./user-detail");
    const { QueryProvider } = await import(
      "../../_components/query-provider.tsx"
    );
    const view = render(
      <QueryProvider>
        <UserDetail
          initialUsers={stateFor()}
          userId="staff-1"
          currentMonth="2026-09"
        />
      </QueryProvider>,
    );
    await user.click(screen.getByRole("button", { name: "表示名を編集" }));
    await user.clear(screen.getByLabelText("表示名"));
    await user.type(screen.getByLabelText("表示名"), "前のユーザーの入力");
    view.rerender(
      <QueryProvider>
        <UserDetail
          initialUsers={stateFor({
            userId: "staff-2",
            displayName: "別スタッフ",
            role: "staff",
            status: "inactive",
          })}
          userId="staff-2"
          currentMonth="2026-09"
        />
      </QueryProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("別スタッフ")).toBeTruthy();
    expect(screen.queryByText("前のユーザーの入力")).toBeNull();
  });
});

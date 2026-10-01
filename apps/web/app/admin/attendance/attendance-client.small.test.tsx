import type {
  AttendanceListItem,
  CancelledAttendanceListItem,
} from "@repo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { within } from "@testing-library/dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AttendanceFilters } from "../../../lib/admin-attendance-filters";
import type {
  AdminAttendanceListState,
  AdminCancelledAttendanceListState,
} from "../../../lib/admin-attendance-types";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { AttendanceClient } from "./attendance-client";

const authStateControl = vi.hoisted(() => ({
  state: {
    status: "ready" as "ready" | "checking" | "error" | "unavailable",
    message: "",
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: authStateControl.state,
  }),
}));

const filters: AttendanceFilters = {
  startAttendanceDateInclusive: "2026-09-01",
  endAttendanceDateInclusive: "2026-09-30",
  userId: "staff-1",
  workPeriod: "night",
  status: "working",
};
const users = [
  {
    userId: "staff-1",
    displayName: "有効スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
];
const attendanceItem: AttendanceListItem = {
  attendanceId: "attendance-1",
  eventVersion: 1,
  attendanceDate: "2026-09-03",
  userId: "staff-1",
  displayName: "有効スタッフ",
  workPeriod: "night",
  clockInAt: "2026-09-03T18:15:00+09:00",
  clockOutAt: null,
  workedMinutes: null,
  status: "working",
};
const cancelledAttendanceItem: CancelledAttendanceListItem = {
  attendanceId: "cancelled-attendance",
  attendanceDate: "2026-09-04",
  userId: "staff-1",
  displayName: "取消済みスタッフ",
  workPeriod: "night",
  clockInAt: "2026-09-04T22:15:00+09:00",
};

function renderClient(
  initialUsers: AdminUsersState = { status: "ready", data: users },
  initialAttendance: AdminAttendanceListState = {
    status: "ready",
    data: [],
  },
  initialCancelledAttendance: AdminCancelledAttendanceListState = {
    status: "ready",
    data: [],
  },
  appliedFilters: AttendanceFilters = filters,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttendanceClient
        appliedFilters={appliedFilters}
        initialAttendance={initialAttendance}
        initialCancelledAttendance={initialCancelledAttendance}
        initialUsers={initialUsers}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  authStateControl.state = { status: "ready", message: "" };
});

describe("AttendanceClient", () => {
  test("ready時は検索条件カード、勤怠一覧、末尾の新規作成導線を表示する", () => {
    renderClient(
      { status: "error", code: "USER_NOT_FOUND", message: "ユーザー取得失敗" },
      { status: "ready", data: [attendanceItem] },
    );
    expect(
      screen.getByRole("link", { name: "勤怠を新規作成" }).getAttribute("href"),
    ).toBe("/admin/attendance/new");
    expect(screen.getByRole("button", { name: /検索条件を開く/ })).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "勤怠一覧" })).getByText(
        "有効スタッフ",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /検索条件を開く/ }));
    const searchForm = screen
      .getByRole("button", { name: "検索" })
      .closest("form");
    if (!searchForm) throw new Error("検索フォームが見つかりません。");
    expect(
      within(searchForm).queryByRole("link", { name: "勤怠を新規作成" }),
    ).toBeNull();
    expect(screen.getByText("ユーザー取得失敗")).toBeTruthy();
    expect(
      (screen.getByLabelText("利用者") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("readyな利用者を検索条件の選択肢に表示する", () => {
    renderClient(
      { status: "ready", data: users },
      { status: "ready", data: [attendanceItem] },
    );
    fireEvent.click(screen.getByRole("button", { name: /検索条件を開く/ }));
    fireEvent.click(screen.getByLabelText("利用者"));
    expect(screen.getByRole("option", { name: "有効スタッフ" })).toBeTruthy();
  });

  test("検索条件付きでも勤怠一覧末尾に新規作成リンクを表示する", () => {
    renderClient(
      undefined,
      { status: "ready", data: [attendanceItem] },
      { status: "ready", data: [] },
      filters,
    );
    expect(
      screen.getByRole("link", { name: "勤怠を新規作成" }).getAttribute("href"),
    ).toBe("/admin/attendance/new");
    expect(screen.getByRole("button", { name: /検索条件を開く/ })).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "勤怠一覧" })).getByText(
        "有効スタッフ",
      ),
    ).toBeTruthy();
  });

  test("status空では通常勤怠と取消済み勤怠を同じ一覧へ表示する", () => {
    renderClient(
      undefined,
      { status: "ready", data: [attendanceItem] },
      { status: "ready", data: [cancelledAttendanceItem] },
      { ...filters, status: "" },
    );
    const list = screen.getByRole("list", { name: "勤怠一覧" });
    expect(within(list).getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(
      within(list).getAllByRole("link", { name: /勤怠詳細へ移動/ }),
    ).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "取消済み勤怠" })).toBeNull();
  });

  test("status空で両方readyの空結果は正常な0件として表示する", () => {
    renderClient();
    expect(screen.getByText("この期間の勤怠はありません。")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "勤怠を新規作成" }).getAttribute("href"),
    ).toBe("/admin/attendance/new");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("status空で片方の取得に失敗した場合は部分結果を表示しない", () => {
    renderClient(
      undefined,
      { status: "error", message: "通常勤怠を取得できませんでした。" },
      { status: "ready", data: [cancelledAttendanceItem] },
      { ...filters, status: "" },
    );
    const listSection = screen.getByRole("region", { name: "勤怠一覧" });
    expect(within(listSection).getByRole("alert").textContent).toContain(
      "通常勤怠を取得できませんでした。",
    );
    expect(screen.queryByText("取消済みスタッフ")).toBeNull();
    expect(screen.queryByText("この期間の勤怠はありません。")).toBeNull();
  });

  test.each(["working", "completed"] as const)(
    "%sでは取消済み勤怠の取得状態に影響されず通常勤怠を表示する",
    (status) => {
      renderClient(
        undefined,
        { status: "ready", data: [attendanceItem] },
        { status: "error", message: "取消済み勤怠を取得できませんでした。" },
        { ...filters, status },
      );
      expect(
        within(screen.getByRole("list", { name: "勤怠一覧" })).getByText(
          "有効スタッフ",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("取消済みスタッフ")).toBeNull();
      expect(
        screen.queryByText("取消済み勤怠を取得できませんでした。"),
      ).toBeNull();
    },
  );

  test("cancelledでは通常勤怠の取得状態に影響されず取消済み勤怠を表示する", () => {
    renderClient(
      undefined,
      { status: "error", message: "通常勤怠を取得できませんでした。" },
      { status: "ready", data: [cancelledAttendanceItem] },
      { ...filters, status: "cancelled" },
    );
    expect(screen.getByText("取消済みスタッフ")).toBeTruthy();
    expect(screen.queryByText("通常勤怠を取得できませんでした。")).toBeNull();
  });

  test("appliedFiltersのcanonical queryを詳細リンクへ渡す", () => {
    renderClient(undefined, { status: "ready", data: [attendanceItem] });
    expect(
      screen.getByRole("link", { name: /勤怠詳細へ移動/ }).getAttribute("href"),
    ).toBe(
      "/admin/attendance/attendance-1?from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=night&status=working",
    );
  });

  test("Auth状態の確認中・失敗時は一覧内容を誤表示しない", () => {
    authStateControl.state = {
      status: "checking",
      message: "認証を確認しています",
    };
    renderClient();
    expect(screen.getByText("認証を確認しています")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "新規作成" })).toBeNull();
    expect(screen.queryByRole("button", { name: "検索" })).toBeNull();
    expect(screen.queryByRole("list", { name: "勤怠一覧" })).toBeNull();

    cleanup();
    authStateControl.state = { status: "error", message: "認証に失敗しました" };
    renderClient();
    expect(screen.getByText("認証に失敗しました")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "新規作成" })).toBeNull();
    expect(screen.queryByRole("button", { name: "検索" })).toBeNull();
    expect(screen.queryByRole("list", { name: "勤怠一覧" })).toBeNull();
  });
});

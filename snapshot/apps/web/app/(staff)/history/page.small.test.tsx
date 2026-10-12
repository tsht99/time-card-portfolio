import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StaffAuthScopeBoundary } from "../_components/staff-auth-scope-boundary.tsx";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  loadHistory: vi.fn(),
  referenceTime: vi.fn(),
  client: vi.fn(() => null),
}));

vi.mock("../../../lib/server/auth-session", () => ({
  resolveAuthenticatedUserSession: mocks.auth,
}));
vi.mock("../../../lib/server/reference-time", () => ({
  getServerReferenceTime: mocks.referenceTime,
}));
vi.mock("../_lib/staff-attendance", () => ({
  loadStaffAttendanceHistory: mocks.loadHistory,
}));
vi.mock("./_components/history-client.tsx", () => ({
  HistoryClient: mocks.client,
}));

const readyAuth = {
  status: "ready" as const,
  user: {
    userId: "staff-1",
    displayName: "スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
};
const readyHistory = { status: "ready" as const, data: [] };

beforeEach(() => {
  mocks.auth.mockResolvedValue(readyAuth);
  mocks.loadHistory.mockResolvedValue(readyHistory);
  mocks.referenceTime.mockReturnValue(new Date("2026-09-17T03:00:00.000Z"));
  mocks.client.mockClear();
});

afterEach(() => {
  vi.resetModules();
  mocks.auth.mockReset();
  mocks.loadHistory.mockReset();
  mocks.referenceTime.mockReset();
});

describe("history page", () => {
  test("有効なmonthをready StaffのuserIdとmonthでloaderへ渡す", async () => {
    const { default: HistoryPage } = await import("./page.tsx");
    const element = await HistoryPage({
      searchParams: Promise.resolve({ month: "2026-08" }),
    });
    expect(element.props.initialAuth).toEqual(readyAuth);
    expect(element.props.children.props).toEqual({
      initialAuth: readyAuth,
      selectedMonth: "2026-08",
      initialAttendanceHistory: readyHistory,
    });
  });

  test("monthが欠落または不正ならserver reference timeのcurrent monthを使う", async () => {
    const { default: HistoryPage } = await import("./page.tsx");
    await HistoryPage({ searchParams: Promise.resolve({}) });
    await HistoryPage({
      searchParams: Promise.resolve({ month: ["2026-08", "2026-07"] }),
    });

    expect(mocks.loadHistory).toHaveBeenNthCalledWith(
      1,
      { userId: "staff-1" },
      "2026-09",
    );
    expect(mocks.loadHistory).toHaveBeenNthCalledWith(
      2,
      { userId: "staff-1" },
      "2026-09",
    );
  });

  test("readyでないauthではloaderを呼ばずinitial historyをnullにする", async () => {
    mocks.auth.mockResolvedValue({
      status: "missing",
      message: "ログインが必要です。",
    });
    const { default: HistoryPage } = await import("./page.tsx");
    expect(mocks.loadHistory).not.toHaveBeenCalled();
    const element = await HistoryPage({
      searchParams: Promise.resolve({ month: "2026-08" }),
    });
    expect(element.props.initialAuth).toEqual({
      status: "missing",
      message: "ログインが必要です。",
    });
    expect(element.props.children.props).toEqual({
      initialAuth: { status: "missing", message: "ログインが必要です。" },
      selectedMonth: "2026-08",
      initialAttendanceHistory: null,
    });
    expect(element.type.name).toBe(StaffAuthScopeBoundary.name);
  });
});

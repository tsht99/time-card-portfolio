import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  loadCurrent: vi.fn(),
  referenceTime: vi.fn(),
  staffPage: vi.fn(() => null),
}));

vi.mock("../../../lib/server/auth-session", () => ({
  resolveStaffAuthSession: mocks.auth,
}));
vi.mock("../../../lib/server/reference-time", () => ({
  getServerReferenceTime: mocks.referenceTime,
}));
vi.mock("../../../lib/server/staff-attendance", () => ({
  loadStaffCurrentAttendance: mocks.loadCurrent,
}));
vi.mock("../_components/staff-page.tsx", () => ({
  StaffPage: mocks.staffPage,
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
const referenceTime = new Date("2026-09-17T03:00:00.000Z");
const readyCurrent = {
  status: "ready" as const,
  data: { referenceDate: "2026-09-17", attendances: [] },
};

beforeEach(() => {
  mocks.auth.mockResolvedValue(readyAuth);
  mocks.loadCurrent.mockResolvedValue(readyCurrent);
  mocks.referenceTime.mockReturnValue(referenceTime);
  mocks.staffPage.mockClear();
});

afterEach(() => {
  vi.resetModules();
  mocks.auth.mockReset();
  mocks.loadCurrent.mockReset();
  mocks.referenceTime.mockReset();
});

describe("clock Staff page", () => {
  test("ready Staffではcurrent loaderをuserIdとserver reference timeで1回呼ぶ", async () => {
    const { default: ClockPage } = await import("./page.tsx");

    const element = await ClockPage();

    expect(mocks.loadCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.loadCurrent).toHaveBeenCalledWith("staff-1", referenceTime);
    expect(element.props.children.props).toEqual({
      initialAuth: readyAuth,
      initialCurrentAttendance: readyCurrent,
    });
  });

  test("readyでないauthではcurrent loaderを呼ばずinitialCurrentAttendanceをnullにする", async () => {
    const initialAuth = {
      status: "missing" as const,
      message: "ログインが必要です。",
    };
    mocks.auth.mockResolvedValue(initialAuth);
    const { default: ClockPage } = await import("./page.tsx");

    const element = await ClockPage();

    expect(mocks.loadCurrent).not.toHaveBeenCalled();
    expect(element.props.children.props).toEqual({
      initialAuth,
      initialCurrentAttendance: null,
    });
  });
});

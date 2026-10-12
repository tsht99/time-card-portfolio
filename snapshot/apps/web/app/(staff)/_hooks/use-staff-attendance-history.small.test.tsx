import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  StaffAttendanceHistory,
  StaffAttendanceHistoryReadState,
} from "../_lib/staff-attendance-types";
import { useStaffAttendanceHistory } from "./use-staff-attendance-history.ts";

const mocks = vi.hoisted(() => ({
  setMonth: vi.fn(),
  refresh: vi.fn(),
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
mocks.router.refresh = mocks.refresh;

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("nuqs", () => ({ useQueryState: () => [null, mocks.setMonth] }));

function historySnapshot(id: string): StaffAttendanceHistory {
  return [
    {
      attendanceId: id,
      eventVersion: 1,
      attendanceDate: "2026-09-01",
      workPeriod: "day",
      clockInAt: "2026-09-01T09:00:00.000Z",
      clockOutAt: null,
      workedMinutes: null,
    },
  ];
}

function readyHistory(
  data: StaffAttendanceHistory,
): StaffAttendanceHistoryReadState {
  return { status: "ready", data };
}

function failedHistory(): StaffAttendanceHistoryReadState {
  return { status: "error", message: "勤怠履歴を取得できませんでした。" };
}

afterEach(() => {
  mocks.setMonth.mockReset();
  mocks.refresh.mockReset();
});

describe("useStaffAttendanceHistory", () => {
  test("初回のready snapshotを返す", () => {
    const history = historySnapshot("history-1");
    const { result } = renderHook(() =>
      useStaffAttendanceHistory({
        initialAttendanceHistory: readyHistory(history),
        selectedMonth: "2026-09",
      }),
    );

    expect(result.current.historySnapshot).toBe(history);
    expect(result.current.historyReadState).toEqual({
      status: "ready",
      data: history,
    });
  });

  test("同月のread failureでは保持済みsnapshotをstale fallbackする", () => {
    const history = historySnapshot("history-1");
    const { result, rerender } = renderHook(
      ({ initialAttendanceHistory, selectedMonth }) =>
        useStaffAttendanceHistory({
          initialAttendanceHistory,
          selectedMonth,
        }),
      {
        initialProps: {
          initialAttendanceHistory: readyHistory(history),
          selectedMonth: "2026-09",
        },
      },
    );

    rerender({
      initialAttendanceHistory: failedHistory(),
      selectedMonth: "2026-09",
    });

    expect(result.current.historySnapshot).toBe(history);
    expect(result.current.historyReadState).toEqual({
      status: "stale",
      data: history,
      message: "勤怠履歴を取得できませんでした。",
    });
  });

  test("選択月が変わった場合は異なる月のsnapshotを流用しない", () => {
    const history = historySnapshot("history-1");
    const { result, rerender } = renderHook(
      ({ initialAttendanceHistory, selectedMonth }) =>
        useStaffAttendanceHistory({
          initialAttendanceHistory,
          selectedMonth,
        }),
      {
        initialProps: {
          initialAttendanceHistory: readyHistory(history),
          selectedMonth: "2026-09",
        },
      },
    );

    rerender({
      initialAttendanceHistory: failedHistory(),
      selectedMonth: "2026-08",
    });

    expect(result.current.historySnapshot).toBeNull();
    expect(result.current.historyReadState.status).toBe("unavailable");
  });

  test("refreshServerは同月の最新snapshotを保存する", () => {
    const historyA = historySnapshot("history-a");
    const historyB = historySnapshot("history-b");
    const { result, rerender } = renderHook(
      ({ initialAttendanceHistory, selectedMonth }) =>
        useStaffAttendanceHistory({
          initialAttendanceHistory,
          selectedMonth,
        }),
      {
        initialProps: {
          initialAttendanceHistory: readyHistory(historyA),
          selectedMonth: "2026-09",
        },
      },
    );

    rerender({
      initialAttendanceHistory: readyHistory(historyB),
      selectedMonth: "2026-09",
    });
    act(() => result.current.refreshServer());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    rerender({
      initialAttendanceHistory: failedHistory(),
      selectedMonth: "2026-09",
    });
    expect(result.current.historySnapshot).toBe(historyB);
    expect(result.current.historyReadState.status).toBe("stale");
  });

  test("navigateMonthはmonth queryをreplaceしてserver updateする", () => {
    const { result, rerender } = renderHook(
      ({ selectedMonth }) =>
        useStaffAttendanceHistory({
          initialAttendanceHistory: null,
          selectedMonth,
        }),
      { initialProps: { selectedMonth: "2026-09" } },
    );

    act(() => result.current.navigateMonth("2026-08"));
    expect(mocks.setMonth).toHaveBeenCalledWith("2026-08");

    rerender({ selectedMonth: "2026-08" });
    act(() => result.current.navigateMonth("2026-09"));
    expect(mocks.setMonth).toHaveBeenCalledWith("2026-09");
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useStaffAttendanceHistory } from "../app/(staff)/_hooks/use-staff-attendance-history.ts";
import { useStaffCurrentAttendance } from "../app/(staff)/_hooks/use-staff-current-attendance.ts";
import type {
  StaffAttendanceHistory,
  StaffAttendanceHistoryReadState,
  StaffCurrentAttendance,
  StaffCurrentAttendanceReadState,
} from "../lib/staff-attendance-types";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  const refresh = vi.fn();
  return { replace, refresh, router: { replace, refresh } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

function currentSnapshot(
  id: string,
  referenceDate = "2026-09-01",
  attendanceDate = referenceDate,
): StaffCurrentAttendance {
  return {
    referenceDate,
    attendances: [
      {
        attendanceId: id,
        eventVersion: 1,
        attendanceDate,
        workPeriod: "day",
        clockInAt: "2026-09-01T09:00:00.000Z",
        clockOutAt: null,
        workedMinutes: null,
      },
    ],
  };
}

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

function readyCurrent(
  data: StaffCurrentAttendance,
): StaffCurrentAttendanceReadState {
  return { status: "ready", data };
}

function failedCurrent(): StaffCurrentAttendanceReadState {
  return { status: "error", message: "現在の勤怠を取得できませんでした。" };
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
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
});

describe("useStaffCurrentAttendance", () => {
  test("初回のready snapshotを返す", () => {
    const current = currentSnapshot("current-1");
    const { result } = renderHook(() =>
      useStaffCurrentAttendance({
        initialCurrentAttendance: readyCurrent(current),
      }),
    );

    expect(result.current.currentSnapshot).toBe(current);
    expect(result.current.currentReadState).toEqual({
      status: "ready",
      data: current,
    });
  });

  test("read failureでは保持済みsnapshotをstale fallbackする", () => {
    const current = currentSnapshot("current-1");
    const { result, rerender } = renderHook(
      ({ initialCurrentAttendance }) =>
        useStaffCurrentAttendance({ initialCurrentAttendance }),
      { initialProps: { initialCurrentAttendance: readyCurrent(current) } },
    );

    rerender({ initialCurrentAttendance: failedCurrent() });

    expect(result.current.currentSnapshot).toBe(current);
    expect(result.current.currentReadState).toEqual({
      status: "stale",
      data: current,
      message: "現在の勤怠を取得できませんでした。",
    });
  });

  test("refreshServerは実行直前の最新snapshotを保存する", () => {
    const currentA = currentSnapshot("current-a");
    const currentB = currentSnapshot("current-b");
    const { result, rerender } = renderHook(
      ({ initialCurrentAttendance }) =>
        useStaffCurrentAttendance({ initialCurrentAttendance }),
      { initialProps: { initialCurrentAttendance: readyCurrent(currentA) } },
    );

    rerender({ initialCurrentAttendance: readyCurrent(currentB) });
    act(() => result.current.refreshServer());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    rerender({ initialCurrentAttendance: failedCurrent() });
    expect(result.current.currentSnapshot).toBe(currentB);
    expect(result.current.currentReadState.status).toBe("stale");
  });

  test("snapshotがnullでもrefreshServerを実行できる", () => {
    const { result } = renderHook(() =>
      useStaffCurrentAttendance({ initialCurrentAttendance: null }),
    );

    expect(() => act(() => result.current.refreshServer())).not.toThrow();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
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

  test("navigateMonthは月だけをreplaceする", () => {
    const { result, rerender } = renderHook(
      ({ selectedMonth }) =>
        useStaffAttendanceHistory({
          initialAttendanceHistory: null,
          selectedMonth,
        }),
      { initialProps: { selectedMonth: "2026-09" } },
    );

    act(() => result.current.navigateMonth("2026-08"));
    expect(mocks.replace).toHaveBeenCalledWith("/clock?month=2026-08", {
      scroll: false,
    });

    rerender({ selectedMonth: "2026-08" });
    act(() => result.current.navigateMonth("2026-09"));
    expect(mocks.replace).toHaveBeenCalledWith("/clock?month=2026-09", {
      scroll: false,
    });
  });

  test("pathnameを指定したnavigateMonthはhistory routeへreplaceする", () => {
    const { result } = renderHook(() =>
      useStaffAttendanceHistory({
        initialAttendanceHistory: null,
        selectedMonth: "2026-09",
        pathname: "/history",
      }),
    );

    act(() => result.current.navigateMonth("2026-08"));
    expect(mocks.replace).toHaveBeenCalledWith("/history?month=2026-08", {
      scroll: false,
    });
  });
});

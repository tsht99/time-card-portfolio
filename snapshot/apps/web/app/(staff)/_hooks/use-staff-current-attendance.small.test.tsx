import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  StaffCurrentAttendance,
  StaffCurrentAttendanceReadState,
} from "../_lib/staff-attendance-types";
import { useStaffCurrentAttendance } from "./use-staff-current-attendance.ts";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  router: { refresh: vi.fn() },
}));
mocks.router.refresh = mocks.refresh;

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

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

function readyCurrent(
  data: StaffCurrentAttendance,
): StaffCurrentAttendanceReadState {
  return { status: "ready", data };
}

function failedCurrent(): StaffCurrentAttendanceReadState {
  return { status: "error", message: "現在の勤怠を取得できませんでした。" };
}

afterEach(() => mocks.refresh.mockReset());

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

import type { AdminAttendanceDetail } from "@repo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAttendanceCancellation } from "./attendance-cancellation";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  reauthenticate: vi.fn(async () => undefined),
  cancel: vi.fn(),
  authState: {
    status: "ready" as const,
    user: { userId: "admin-1" },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: mocks.authState,
    reauthenticate: mocks.reauthenticate,
  }),
}));
vi.mock("../_actions/attendance-actions.ts", () => ({
  cancelAdminAttendanceAction: mocks.cancel,
}));

const completed: AdminAttendanceDetail = {
  attendanceId: "attendance-1",
  eventVersion: 2,
  attendanceDate: "2026-09-03",
  userId: "staff-1",
  displayName: "有効スタッフ",
  workPeriod: "day",
  clockInAt: "2026-09-03T09:15:00.000Z",
  clockOutAt: "2026-09-03T18:00:00.000Z",
  workedMinutes: 525,
  status: "completed",
  payroll: {
    hourlyWage: null,
    estimatedPayYen: null,
    status: "missingHourlyWage",
  },
  history: [],
};

function Harness() {
  const operations = useAttendanceCancellation();
  return (
    <>
      <button type="button" onClick={() => operations.cancel(completed)}>
        取消
      </button>
      {operations.cancellationError && (
        <p role="alert">{operations.cancellationError.message}</p>
      )}
    </>
  );
}

function renderOperations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.reauthenticate.mockReset().mockResolvedValue(undefined);
  mocks.cancel.mockReset().mockResolvedValue({
    success: true,
    attendanceId: "attendance-1",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAttendanceCancellation", () => {
  test("cancelはDialog確定後のpayloadを送り、成功とconflictだけrefreshする", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    renderOperations();

    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith({
        attendanceId: "attendance-1",
        expectedVersion: 2,
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    mocks.refresh.mockReset();
    mocks.cancel.mockResolvedValueOnce({
      success: false,
      code: "ATTENDANCE_VERSION_CONFLICT",
      message: "競合しました。",
    });
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.cancel).toHaveBeenLastCalledWith({
      attendanceId: "attendance-1",
      expectedVersion: 2,
    });

    mocks.refresh.mockReset();
    mocks.cancel.mockResolvedValueOnce({
      success: false,
      message: "取消できません。",
    });
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(await screen.findByText("取消できません。"));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  test("SESSION_EXPIREDは再認証後に一度だけretryする", async () => {
    const user = userEvent.setup();
    mocks.cancel
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "期限切れ",
      })
      .mockResolvedValueOnce({ success: true, attendanceId: "attendance-1" });
    renderOperations();
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(mocks.cancel).toHaveBeenCalledTimes(2);
      expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
    });
  });
});

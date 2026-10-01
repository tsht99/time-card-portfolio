import type { StaffAttendanceItem } from "@repo/contracts";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";
import type { MonthlyRow } from "../../../lib/monthly-attendance-view-model";
import { StaffAttendanceHistoryPanel } from "./staff-attendance-history-panel.tsx";

function attendance(
  attendanceId: string,
  workPeriod: "day" | "night",
  clockInAt: string,
  clockOutAt: string | null,
): StaffAttendanceItem {
  return {
    attendanceId,
    eventVersion: 1,
    attendanceDate: clockInAt.slice(0, 10),
    workPeriod,
    clockInAt,
    clockOutAt,
    workedMinutes: clockOutAt === null ? null : 540,
  };
}

const history: MonthlyRow[] = [
  {
    date: "2026-09-01",
    attendance: {
      night: [
        attendance("night-1", "night", "2026-09-01T22:00:00+09:00", null),
      ],
      day: [
        attendance(
          "day-1",
          "day",
          "2026-09-01T09:00:00+09:00",
          "2026-09-01T18:00:00+09:00",
        ),
      ],
    },
  },
];

function renderHistory(
  attendanceHistory: MonthlyRow[] = history,
  overrides: Partial<ComponentProps<typeof StaffAttendanceHistoryPanel>> = {},
) {
  return render(
    <StaffAttendanceHistoryPanel
      attendanceHistory={attendanceHistory}
      selectedMonth="2026-09"
      historyError={null}
      hasHistorySnapshot={false}
      isRefreshing={false}
      onMonthChange={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />,
  );
}

test("昼夜の勤務区分、勤務日、日時と勤務状態を表示する", () => {
  renderHistory();

  expect(screen.getAllByText("昼")).toHaveLength(1);
  expect(screen.getAllByText("夜")).toHaveLength(1);
  expect(screen.getAllByText("1日")).toHaveLength(2);
  expect(screen.getByText("18:00")).toBeTruthy();
  expect(screen.getByText("22:00")).toBeTruthy();
  expect(screen.getByText("勤務中")).toBeTruthy();
  expect(screen.getAllByText("1日")).toHaveLength(2);
  expect(screen.getByText("18:00")).toBeTruthy();
  expect(screen.getByText("22:00")).toBeTruthy();
});

test("翌日の退勤時刻だけ24時超で表示し、出勤時刻は変更しない", () => {
  const overnight = attendance(
    "night-overnight",
    "night",
    "2026-09-01T22:00:00+09:00",
    "2026-09-02T01:00:00+09:00",
  );

  const { container } = renderHistory([
    {
      date: "2026-09-01",
      attendance: { night: [overnight], day: [] },
    },
  ]);

  expect(container.textContent).toContain("1日夜22:00→25:00");
});

test("同じ日の履歴は勤務区分によらず出勤日時順で全件表示し、入力を変更しない", () => {
  const attendanceHistory: MonthlyRow[] = [
    {
      date: "2026-09-01",
      attendance: {
        night: [
          attendance("night-late", "night", "2026-09-01T17:00:00+09:00", null),
          attendance("night-early", "night", "2026-09-01T12:00:00+09:00", null),
        ],
        day: [
          attendance("day-late", "day", "2026-09-01T17:00:00+09:00", null),
          attendance("day-early", "day", "2026-09-01T12:00:00+09:00", null),
        ],
      },
    },
  ];
  const original = structuredClone(attendanceHistory);
  const { container } = renderHistory(attendanceHistory);
  const displayed = container.textContent ?? "";
  let previousIndex = -1;
  for (const item of [
    "1日昼12:00→勤務中",
    "1日夜12:00→勤務中",
    "1日昼17:00→勤務中",
    "1日夜17:00→勤務中",
  ]) {
    const index = displayed.indexOf(item);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
  expect(attendanceHistory).toEqual(original);
});

test("同時刻はattendanceId順で、日付は新しい順に表示する", () => {
  const attendanceHistory: MonthlyRow[] = [
    {
      date: "2026-09-02",
      attendance: {
        night: [],
        day: [attendance("newer", "day", "2026-09-02T09:00:00+09:00", null)],
      },
    },
    {
      date: "2026-09-01",
      attendance: {
        night: [attendance("b", "night", "2026-09-01T09:00:00+09:00", null)],
        day: [attendance("a", "day", "2026-09-01T09:00:00+09:00", null)],
      },
    },
  ];
  const { container } = renderHistory(attendanceHistory);
  const displayed = container.textContent ?? "";
  expect(displayed.indexOf("2日昼09:00→勤務中")).toBeLessThan(
    displayed.indexOf("1日昼09:00→勤務中"),
  );
  expect(displayed.indexOf("1日昼09:00→勤務中")).toBeLessThan(
    displayed.indexOf("1日夜09:00→勤務中"),
  );
});

test("月ナビゲーションは前後のtarget monthを渡す", () => {
  const onMonthChange = vi.fn();
  renderHistory(history, { onMonthChange });

  expect(
    screen.getByRole("group", { name: "月次勤怠の月ナビゲーション" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();
  screen.getByRole("button", { name: "前の月" }).click();
  screen.getByRole("button", { name: "次の月" }).click();
  expect(onMonthChange).toHaveBeenNthCalledWith(1, "2026-08");
  expect(onMonthChange).toHaveBeenNthCalledWith(2, "2026-10");
});

test("取得済み0件では空状態を表示する", () => {
  renderHistory([], { hasHistorySnapshot: true });
  expect(screen.getByText("この月の打刻はありません。")).toBeTruthy();
});

test("0件の更新中は更新中だけを表示する", () => {
  const { rerender } = renderHistory([], {
    hasHistorySnapshot: true,
    isRefreshing: true,
  });
  expect(screen.getByText("勤怠履歴を更新中")).toBeTruthy();
  expect(screen.queryByText("この月の打刻はありません。")).toBeNull();

  rerender(
    <StaffAttendanceHistoryPanel
      attendanceHistory={[]}
      selectedMonth="2026-09"
      historyError={null}
      hasHistorySnapshot={false}
      isRefreshing
      onMonthChange={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByText("勤怠履歴を読み込み中")).toBeTruthy();
  expect(screen.queryByText("この月の打刻はありません。")).toBeNull();
});

test("Snapshotがない非更新中の0件では未取得を空状態と確定しない", () => {
  renderHistory([], { hasHistorySnapshot: false });
  expect(screen.queryByText("この月の打刻はありません。")).toBeNull();
});

test("履歴がある更新中は更新中と既存履歴を表示する", () => {
  renderHistory(history, {
    hasHistorySnapshot: true,
    isRefreshing: true,
  });
  expect(screen.getByText("勤怠履歴を更新中")).toBeTruthy();
  expect(screen.queryByText("この月の打刻はありません。")).toBeNull();
  expect(screen.getByText("勤務中")).toBeTruthy();
});

test("取得失敗時は空状態を表示せず再試行を維持する", () => {
  const { rerender } = renderHistory([], { hasHistorySnapshot: true });

  const onRetry = vi.fn();
  rerender(
    <StaffAttendanceHistoryPanel
      attendanceHistory={[]}
      selectedMonth="2026-09"
      historyError="勤怠履歴を取得できませんでした。"
      hasHistorySnapshot={false}
      isRefreshing={false}
      onMonthChange={vi.fn()}
      onRetry={onRetry}
    />,
  );
  expect(screen.queryByText("この月の打刻はありません。")).toBeNull();
  expect(screen.getByText("勤怠履歴を取得できませんでした。")).toBeTruthy();
  screen.getByRole("button", { name: "再試行" }).click();
  expect(onRetry).toHaveBeenCalledTimes(1);
});

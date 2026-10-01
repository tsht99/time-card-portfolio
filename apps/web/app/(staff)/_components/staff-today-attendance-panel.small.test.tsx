import type { StaffAttendanceItem } from "@repo/contracts";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StaffTodayAttendancePanel } from "./staff-today-attendance-panel.tsx";

function attendance(
  attendanceId: string,
  workPeriod: "day" | "night",
  clockInAt: string,
  clockOutAt: string | null,
): StaffAttendanceItem {
  return {
    attendanceId,
    eventVersion: 1,
    attendanceDate: "2026-09-01",
    workPeriod,
    clockInAt,
    clockOutAt,
    workedMinutes: clockOutAt === null ? null : 540,
  };
}

test("昼夜の勤務区分を共通ラベルで表示する", () => {
  render(
    <StaffTodayAttendancePanel
      attendances={[
        attendance(
          "day-1",
          "day",
          "2026-09-01T09:00:00+09:00",
          "2026-09-01T18:00:00+09:00",
        ),
        attendance("night-1", "night", "2026-09-01T22:00:00+09:00", null),
      ]}
    />,
  );

  expect(screen.getAllByText("昼")).toHaveLength(1);
  expect(screen.getAllByText("夜")).toHaveLength(1);
  expect(screen.getByText("昼")).toBeTruthy();
  expect(screen.getByText("夜")).toBeTruthy();
});

test("日時と勤務状態を閲覧表示し編集・取消操作を提供しない", () => {
  const { container } = render(
    <StaffTodayAttendancePanel
      attendances={[
        attendance(
          "day-1",
          "day",
          "2026-09-01T09:00:00+09:00",
          "2026-09-01T18:00:00+09:00",
        ),
        attendance("night-1", "night", "2026-09-01T22:00:00+09:00", null),
      ]}
    />,
  );

  expect(container.textContent).toContain("昼09:00→18:00");
  expect(container.textContent).toContain("夜22:00→勤務中");
  expect(screen.queryByRole("button", { name: /編集|取消|取り消/ })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("翌日の退勤時刻だけ24時超で表示し、出勤時刻は変更しない", () => {
  const { container } = render(
    <StaffTodayAttendancePanel
      attendances={[
        attendance(
          "night-1",
          "night",
          "2026-09-01T22:00:00+09:00",
          "2026-09-02T01:00:00+09:00",
        ),
      ]}
    />,
  );

  expect(container.textContent).toContain("夜22:00→25:00");
});

test("出勤日時の昇順で表示し、同時刻はattendanceId順にして入力を変更しない", () => {
  const attendances = [
    attendance("night-late", "night", "2026-09-01T17:00:00+09:00", null),
    attendance("day-late", "day", "2026-09-01T17:00:00+09:00", null),
    attendance("day-early", "day", "2026-09-01T12:00:00+09:00", null),
    attendance("night-early", "night", "2026-09-01T12:00:00+09:00", null),
  ];
  const original = [...attendances];
  const { container } = render(
    <StaffTodayAttendancePanel attendances={attendances} />,
  );

  const displayed = container.textContent ?? "";
  let previousIndex = -1;
  for (const item of [
    "昼12:00→勤務中",
    "夜12:00→勤務中",
    "昼17:00→勤務中",
    "夜17:00→勤務中",
  ]) {
    const index = displayed.indexOf(item);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
  expect(attendances).toEqual(original);
});

test("空状態と取得失敗時は勤務区分ラベルを表示しない", () => {
  const { rerender } = render(<StaffTodayAttendancePanel attendances={[]} />);
  expect(screen.getByText("今日の打刻はありません。")).toBeTruthy();
  expect(screen.queryByText("昼")).toBeNull();
  expect(screen.queryByText("夜")).toBeNull();

  rerender(<StaffTodayAttendancePanel attendances={null} />);
  expect(screen.getByText("今日の勤怠を確認できません。")).toBeTruthy();
  expect(screen.queryByText("昼")).toBeNull();
  expect(screen.queryByText("夜")).toBeNull();
});

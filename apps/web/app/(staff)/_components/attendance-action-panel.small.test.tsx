import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AttendanceActionPanel } from "./attendance-action-panel.tsx";

describe("AttendanceActionPanel", () => {
  test.each([
    ["not_working", "未勤務"],
    ["working_day", "昼勤務中"],
    ["working_night", "夜勤務中"],
  ] as const)("%sでは状態表示を表示する", (clockState, statusLabel) => {
    render(
      <AttendanceActionPanel
        statusLabel={statusLabel}
        isError={false}
        clockState={clockState}
        canStart={{ day: false, night: false }}
        time="09:00"
        busy={false}
        errorMessage={null}
        onRetry={null}
        onTimeChange={vi.fn()}
        onClockIn={vi.fn()}
        onClockOut={vi.fn()}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toBe(statusLabel);
    expect(status.textContent).not.toContain("09:00");
    expect(status.textContent).not.toContain("·");
    if (clockState === "not_working") {
      expect(screen.getByRole("button", { name: "昼に出勤" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "夜に出勤" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "退勤" })).toBeNull();
    } else {
      expect(screen.getByRole("button", { name: "退勤" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "昼に出勤" })).toBeNull();
      expect(screen.queryByRole("button", { name: "夜に出勤" })).toBeNull();
    }
  });

  test("未勤務時の出勤ボタンは昼夜の値を渡す", () => {
    const onClockIn = vi.fn();

    render(
      <AttendanceActionPanel
        statusLabel="未勤務"
        isError={false}
        clockState="not_working"
        canStart={{ day: true, night: true }}
        time="09:00"
        busy={false}
        errorMessage={null}
        onRetry={null}
        onTimeChange={vi.fn()}
        onClockIn={onClockIn}
        onClockOut={vi.fn()}
      />,
    );

    const dayButton = screen.getByRole("button", { name: "昼に出勤" });
    const nightButton = screen.getByRole("button", { name: "夜に出勤" });
    fireEvent.click(dayButton);
    fireEvent.click(nightButton);
    expect(onClockIn).toHaveBeenNthCalledWith(1, "day");
    expect(onClockIn).toHaveBeenNthCalledWith(2, "night");
  });

  test.each([
    ["busy", { day: true, night: true }, true, true, true],
    ["昼が開始不可", { day: false, night: true }, false, true, false],
    ["夜が開始不可", { day: true, night: false }, false, false, true],
  ] as const)(
    "未勤務時は%sの出勤ボタンだけ従来どおり無効になる",
    (_caseName, canStart, busy, expectedDayDisabled, expectedNightDisabled) => {
      render(
        <AttendanceActionPanel
          statusLabel="未勤務"
          isError={false}
          clockState="not_working"
          canStart={canStart}
          time="09:00"
          busy={busy}
          errorMessage={null}
          onRetry={null}
          onTimeChange={vi.fn()}
          onClockIn={vi.fn()}
          onClockOut={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("button", { name: "昼に出勤" }).matches(":disabled"),
      ).toBe(expectedDayDisabled);
      expect(
        screen.getByRole("button", { name: "夜に出勤" }).matches(":disabled"),
      ).toBe(expectedNightDisabled);
    },
  );

  test.each(["day", "night"] as const)(
    "%sの出勤送信中だけ対象ボタンの文言を変更する",
    (pendingWorkPeriod) => {
      render(
        <AttendanceActionPanel
          statusLabel="未勤務"
          isError={false}
          clockState="not_working"
          canStart={{ day: true, night: true }}
          time="09:00"
          busy
          pendingOperation="clock_in"
          pendingWorkPeriod={pendingWorkPeriod}
          errorMessage={null}
          onRetry={null}
          onTimeChange={vi.fn()}
          onClockIn={vi.fn()}
          onClockOut={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: "出勤中…" })).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: pendingWorkPeriod === "day" ? "夜に出勤" : "昼に出勤",
        }),
      ).toBeTruthy();
    },
  );

  test.each(["working_day", "working_night"] as const)(
    "%sでは退勤だけを操作できる",
    (clockState) => {
      render(
        <AttendanceActionPanel
          statusLabel={clockState === "working_day" ? "昼勤務中" : "夜勤務中"}
          isError={false}
          clockState={clockState}
          canStart={{ day: false, night: false }}
          time="09:00"
          busy={false}
          errorMessage={null}
          onRetry={null}
          onTimeChange={vi.fn()}
          onClockIn={vi.fn()}
          onClockOut={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: "退勤" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "昼に出勤" })).toBeNull();
      expect(screen.queryByRole("button", { name: "夜に出勤" })).toBeNull();
    },
  );

  test.each([
    ["確認中", false],
    ["エラー", true],
  ] as const)(
    "clockStateがnullの%s表示は従来どおり維持する",
    (statusLabel, isError) => {
      render(
        <AttendanceActionPanel
          statusLabel={statusLabel}
          isError={isError}
          clockState={null}
          canStart={{ day: false, night: false }}
          time="09:00"
          busy={false}
          errorMessage={null}
          onRetry={null}
          onTimeChange={vi.fn()}
          onClockIn={vi.fn()}
          onClockOut={vi.fn()}
        />,
      );

      const status = screen.getByRole("status");
      expect(status.textContent).toBe(statusLabel);
      expect(screen.queryByLabelText("打刻時刻")).toBeNull();
    },
  );

  test("clockStateがあってもエラー表示を優先する", () => {
    render(
      <AttendanceActionPanel
        statusLabel="エラー"
        isError
        clockState="not_working"
        canStart={{ day: false, night: false }}
        time="09:00"
        busy={false}
        errorMessage={null}
        onRetry={null}
        onTimeChange={vi.fn()}
        onClockIn={vi.fn()}
        onClockOut={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("エラー");
    expect(screen.getByLabelText("打刻時刻")).toBeTruthy();
  });
});

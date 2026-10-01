import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MonthNavigation } from "./month-navigation.tsx";

afterEach(() => {
  cleanup();
});

test("前月・次月を年月で通知し、年跨ぎする", () => {
  const onMonthChange = vi.fn();
  render(
    <MonthNavigation
      selectedMonth="2026-01"
      ariaLabel="月"
      onMonthChange={onMonthChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "前の月" }));
  fireEvent.click(screen.getByRole("button", { name: "次の月" }));
  expect(onMonthChange).toHaveBeenNthCalledWith(1, "2025-12");
  expect(onMonthChange).toHaveBeenNthCalledWith(2, "2026-02");
  expect(screen.getByRole("heading", { name: "2026年1月" })).toBeTruthy();
});

test("年月の上下限で矢印を無効にする", () => {
  const { rerender } = render(
    <MonthNavigation
      selectedMonth="0001-01"
      ariaLabel="月"
      onMonthChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "前の月" })).toHaveProperty(
    "disabled",
    true,
  );
  rerender(
    <MonthNavigation
      selectedMonth="9999-12"
      ariaLabel="月"
      onMonthChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "次の月" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("不正な選択月では前月・次月の矢印を無効にする", () => {
  render(
    <MonthNavigation
      selectedMonth="invalid"
      ariaLabel="月"
      onMonthChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "前の月" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "次の月" })).toHaveProperty(
    "disabled",
    true,
  );
});

test("直接選択は許可時だけ表示し、キャンセルとEscapeを維持する", () => {
  const onMonthChange = vi.fn();
  const { rerender } = render(
    <MonthNavigation
      selectedMonth="2026-09"
      ariaLabel="月"
      onMonthChange={onMonthChange}
    />,
  );
  expect(screen.queryByLabelText("月を直接選択")).toBeNull();
  rerender(
    <MonthNavigation
      selectedMonth="2026-09"
      ariaLabel="月"
      onMonthChange={onMonthChange}
      allowDirectSelection
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "月を直接選択" }));
  const input = screen.getByLabelText("月を直接選択");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByLabelText("月選択を中止")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "月を直接選択" }));
  fireEvent.click(screen.getByRole("button", { name: "月選択を中止" }));
  expect(onMonthChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "月を直接選択" }));
  fireEvent.change(screen.getByLabelText("月を直接選択"), {
    target: { value: "0000-12" },
  });
  expect(onMonthChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText("月を直接選択")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("月を直接選択"), {
    target: { value: "2026-10" },
  });
  expect(onMonthChange).toHaveBeenCalledWith("2026-10");
});

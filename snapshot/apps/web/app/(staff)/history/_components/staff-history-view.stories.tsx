import type { StaffAttendanceItem } from "@repo/contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { mergeMonthlyAttendance } from "../../_lib/monthly-attendance-view-model";
import { StaffHistoryView } from "./staff-history-view.tsx";

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const selectedMonth = "2026-09";
const attendance = {
  attendanceId: "fixture-day-1",
  eventVersion: 2,
  attendanceDate: "2026-09-12",
  workPeriod: "day",
  clockInAt: "2026-09-12T00:00:00.000Z",
  clockOutAt: "2026-09-15T18:59:00.000Z",
  workedMinutes: 540,
} satisfies StaffAttendanceItem;

const meta = {
  title: "Staff/履歴",
  component: StaffHistoryView,
  args: {
    selectedMonth,
    historyError: null,
    hasHistorySnapshot: true,
    isRefreshing: false,
    onMonthChange: () => undefined,
    onRetry: () => undefined,
  },
} satisfies Meta<typeof StaffHistoryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 勤怠あり: Story = {
  args: {
    attendanceHistory: mergeMonthlyAttendance(
      [attendance],
      null,
      selectedMonth,
    ),
  },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    for (const width of [320, 390]) {
      await page.viewport(width, 844);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
      expect(canvasElement.textContent).toContain("99:59");
      const navigation = canvasElement.querySelector(
        '[aria-label="勤怠画面の切り替え"]',
      );
      const monthNavigation = canvasElement.querySelector(
        '[aria-label="月次勤怠の月ナビゲーション"]',
      );
      for (const element of [navigation, monthNavigation]) {
        expect(element).not.toBeNull();
        const rect = required(element, "element").getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
      }
    }
  },
};

export const 空状態: Story = {
  args: { attendanceHistory: [] },
};

export const 取得失敗: Story = {
  args: {
    attendanceHistory: [],
    hasHistorySnapshot: false,
    historyError: "勤怠履歴を取得できませんでした。",
  },
};

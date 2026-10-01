import type { StaffAttendanceItem } from "@repo/contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mergeMonthlyAttendance } from "../../../lib/monthly-attendance-view-model";
import { StaffHistoryView } from "./staff-history-view.tsx";

const selectedMonth = "2026-09";
const attendance = {
  attendanceId: "fixture-day-1",
  eventVersion: 2,
  attendanceDate: "2026-09-12",
  workPeriod: "day",
  clockInAt: "2026-09-12T00:00:00.000Z",
  clockOutAt: "2026-09-12T09:00:00.000Z",
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

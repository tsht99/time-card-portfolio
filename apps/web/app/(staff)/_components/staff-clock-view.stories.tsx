import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StaffClockView } from "./staff-clock-view.tsx";

const meta = {
  title: "Staff/打刻",
  component: StaffClockView,
  args: {
    time: "09:00",
    busy: false,
    canStart: { day: true, night: true },
    errorMessage: null,
    onRetry: null,
    onTimeChange: () => undefined,
    onClockIn: () => undefined,
    onClockOut: () => undefined,
    todayAttendances: [],
  },
} satisfies Meta<typeof StaffClockView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 未勤務: Story = {
  args: {
    statusLabel: "未勤務",
    isError: false,
    clockState: "not_working",
  },
};

export const 昼勤務中: Story = {
  args: {
    statusLabel: "昼勤務中",
    isError: false,
    clockState: "working_day",
  },
};

export const 夜勤務中: Story = {
  args: {
    statusLabel: "夜勤務中",
    isError: false,
    clockState: "working_night",
  },
};

export const エラーと再試行: Story = {
  args: {
    statusLabel: "エラー",
    isError: true,
    clockState: null,
    canStart: { day: false, night: false },
    errorMessage: "最新の勤務状態を取得できませんでした。",
    onRetry: () => undefined,
  },
};

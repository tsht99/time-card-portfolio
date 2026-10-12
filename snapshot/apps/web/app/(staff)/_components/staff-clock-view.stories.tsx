import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { StaffClockView } from "./staff-clock-view.tsx";

async function expectStaffFits(width: number, canvasElement: HTMLElement) {
  await page.viewport(width, 844);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  await expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
  const navigation = canvasElement.querySelector(
    '[aria-label="勤怠画面の切り替え"]',
  );
  const action = canvasElement.querySelector("button");
  expect(navigation).not.toBeNull();
  expect(action).not.toBeNull();
  for (const element of [navigation, action]) {
    const rect = required(element, "element").getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
  }
  const date =
    canvasElement.querySelector("time") ??
    [...canvasElement.querySelectorAll("span")].find((element) =>
      element.textContent?.includes("2026年9月12日（土）"),
    );
  const timeInput = canvasElement.querySelector('input[type="time"]');
  const dateElement = required(date, "date");
  const card = required(
    canvasElement.querySelector<HTMLElement>('[data-slot="card"]'),
    "clock action card",
  );
  const dateRect = dateElement.getBoundingClientRect();
  const inputElement = required(timeInput, "time input");
  const timeRect = inputElement.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const cardStyle = getComputedStyle(card);
  const content = {
    left:
      cardRect.left +
      Number.parseFloat(cardStyle.borderLeftWidth) +
      Number.parseFloat(cardStyle.paddingLeft),
    right:
      cardRect.right -
      Number.parseFloat(cardStyle.borderRightWidth) -
      Number.parseFloat(cardStyle.paddingRight),
    top:
      cardRect.top +
      Number.parseFloat(cardStyle.borderTopWidth) +
      Number.parseFloat(cardStyle.paddingTop),
    bottom:
      cardRect.bottom -
      Number.parseFloat(cardStyle.borderBottomWidth) -
      Number.parseFloat(cardStyle.paddingBottom),
  };
  expect(dateElement.scrollWidth).toBeLessThanOrEqual(dateElement.clientWidth);
  expect(dateRect.right).toBeLessThanOrEqual(timeRect.left);
  expect(Math.abs(timeRect.right - content.right)).toBeLessThanOrEqual(1);
  for (const rect of [dateRect, timeRect]) {
    expect(rect.left).toBeGreaterThanOrEqual(content.left);
    expect(rect.right).toBeLessThanOrEqual(content.right);
    expect(rect.top).toBeGreaterThanOrEqual(content.top);
    expect(rect.bottom).toBeLessThanOrEqual(content.bottom);
  }
  expect(
    Math.abs(
      dateRect.top + dateRect.height / 2 - (timeRect.top + timeRect.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const meta = {
  title: "Staff/打刻",
  component: StaffClockView,
  args: {
    time: "09:00",
    date: "2026-09-12",
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
    workStatus: "not_working",
  },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    await expectStaffFits(320, canvasElement);
    await expectStaffFits(390, canvasElement);
    await expectStaffFits(1365, canvasElement);
    const input = canvasElement.querySelector('input[type="time"]');
    await expect(input).toHaveAttribute(
      "aria-label",
      "打刻時刻 2026年9月12日（土）",
    );
    expect(canvasElement.textContent).toContain("2026年9月12日（土）");
    expect(canvasElement.textContent).not.toContain("打刻時刻");
  },
};

export const 昼勤務中: Story = {
  args: {
    statusLabel: "昼勤務中",
    isError: false,
    workStatus: "working_day",
    todayAttendances: [
      {
        attendanceId: "fixture-working-day",
        eventVersion: 1,
        attendanceDate: "2026-09-12",
        workPeriod: "day",
        clockInAt: "2026-09-12T00:00:00.000Z",
        clockOutAt: null,
        workedMinutes: null,
      },
    ],
  },
  parameters: { a11y: { test: "error" } },
};

export const 夜勤務中: Story = {
  args: {
    statusLabel: "夜勤務中",
    isError: false,
    workStatus: "working_night",
  },
};

export const エラーと再試行: Story = {
  args: {
    statusLabel: "エラー",
    isError: true,
    workStatus: null,
    canStart: { day: false, night: false },
    errorMessage: "最新の勤務状態を取得できませんでした。",
    onRetry: () => undefined,
  },
};

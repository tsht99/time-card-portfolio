// cspell:ignore uncomputed
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { AdminShellView } from "../../../../_components/admin-shell-view";
import type { AdminUserMonthlyPayrollEstimateDetailState } from "../../../../_lib/admin-payroll-estimate-types.ts";
import { PayrollEstimateDetailView } from "./detail-view";

const longName = `給与見込み対象スタッフ-${"長い表示名".repeat(12)}`;
const calculatedAndUncomputed: AdminUserMonthlyPayrollEstimateDetailState = {
  status: "ready",
  data: {
    userId: "staff-payroll-estimate-fixture",
    month: "2026-09",
    displayName: longName,
    totalEstimatedPayYen: 10800,
    uncomputedCount: 1,
    roundingAdjustmentYen: 0,
    attendances: [
      {
        attendanceId: "payroll-estimate-calculated",
        attendanceDate: "2026-09-12",
        workPeriod: "day",
        clockInAt: "2026-09-12T00:00:00.000Z",
        clockOutAt: "2026-09-12T09:00:00.000Z",
        workedMinutes: 540,
        hourlyWage: 1200,
        estimatedPayYenTimes60: 648000,
        estimatedPayYen: 10800,
        status: "calculated",
      },
      {
        attendanceId: "payroll-estimate-uncomputed",
        attendanceDate: "2026-09-13",
        workPeriod: "night",
        clockInAt: "2026-09-13T11:00:00.000Z",
        clockOutAt: null,
        workedMinutes: null,
        hourlyWage: 1400,
        estimatedPayYenTimes60: null,
        estimatedPayYen: null,
        status: "clockOutMissing",
      },
    ],
  },
};

const meta = {
  title: "Admin/給与見込み詳細",
  component: PayrollEstimateDetailView,
  decorators: [
    (Story) => (
      <AdminShellView
        pathname="/admin/users/staff-fixture/payroll-estimates"
        isAuthReady
      >
        <Story />
      </AdminShellView>
    ),
  ],
  args: {
    state: calculatedAndUncomputed,
    month: "2026-09",
    navigateToMonth: () => undefined,
  },
} satisfies Meta<typeof PayrollEstimateDetailView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 通常と未算出勤怠: Story = {
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    for (const width of [320, 390, 1280]) {
      await page.viewport(width, 900);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
      expect(
        canvasElement.querySelector('[aria-label="給与見込み額"]'),
      ).not.toBeNull();
      expect(
        canvasElement.querySelector('[aria-label="勤怠別給与見込み明細"]'),
      ).not.toBeNull();
      expect(canvasElement.textContent).toContain("未算出 1件");
    }
  },
};

export const Loading: Story = {
  name: "読み込み中",
  args: { ...meta.args, loading: true },
  parameters: { a11y: { test: "error" } },
};

export const Empty: Story = {
  name: "勤怠なし",
  args: {
    ...meta.args,
    state: {
      status: "ready",
      data: {
        ...calculatedAndUncomputed.data,
        attendances: [],
        totalEstimatedPayYen: 0,
        uncomputedCount: 0,
      },
    },
  },
  parameters: { a11y: { test: "error" } },
};

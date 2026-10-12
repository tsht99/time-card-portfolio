import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { AdminShellView } from "../../_components/admin-shell-view";
import type { AdminMonthlyPayrollEstimateSummaryState } from "../../_lib/admin-payroll-estimate-types.ts";
import type { AdminUserListState } from "../../_lib/admin-user-management-types.ts";
import { PayrollEstimateListView } from "./list-view";

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const users: AdminUserListState = {
  status: "ready",
  data: [
    {
      userId: "staff-fiction-1",
      displayName: "山田 花子",
      role: "staff",
      status: "active",
    },
    {
      userId: "staff-fiction-2",
      displayName: "佐藤 太郎",
      role: "staff",
      status: "active",
    },
  ],
};
const clearSummary: AdminMonthlyPayrollEstimateSummaryState = {
  status: "ready",
  data: [
    {
      userId: "staff-fiction-1",
      incompleteCount: 0,
      missingHourlyWageCount: 0,
      hasWorkingAttendance: false,
      otherIncompleteCount: 0,
      totalWorkedMinutes: 960,
      totalEstimatedPayYen: 128000,
    },
  ],
};
const warningSummary: AdminMonthlyPayrollEstimateSummaryState = {
  status: "ready",
  data: [
    {
      userId: "staff-fiction-2",
      incompleteCount: 1,
      missingHourlyWageCount: 0,
      hasWorkingAttendance: true,
      otherIncompleteCount: 0,
      totalWorkedMinutes: 300,
      totalEstimatedPayYen: 42000,
    },
  ],
};
const meta = {
  title: "Admin/給与見込み一覧",
  component: PayrollEstimateListView,
  decorators: [
    (Story) => (
      <AdminShellView pathname="/admin/payroll-estimates" isAuthReady>
        {Story()}
      </AdminShellView>
    ),
  ],
} satisfies Meta<typeof PayrollEstimateListView>;
export default meta;
type Story = StoryObj<typeof meta>;
const base = {
  authState: { status: "ready" as const, message: "" },
  month: "2026-09",
  navigateToMonth: () => undefined,
  initialUsers: users,
  pending: false,
  error: null,
  isValidSelectedMonth: true,
  userResolutionError: null,
  canDisplaySummaries: true,
};
export const 通常データ: Story = {
  args: {
    ...base,
    summaries: clearSummary.data,
    sortedSummaries: clearSummary.data,
  },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    for (const width of [320, 390, 1280]) {
      await page.viewport(width, 900);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
      const main = canvasElement.querySelector("main");
      expect(main).not.toBeNull();
      expect(
        required(main, "main element").getBoundingClientRect().right,
      ).toBeLessThanOrEqual(width);
    }
  },
};
export const 要確認を含む: Story = {
  args: {
    ...base,
    summaries: [...clearSummary.data, ...warningSummary.data],
    sortedSummaries: [...clearSummary.data, ...warningSummary.data],
  },
  parameters: { a11y: { test: "error" } },
};
export const Empty: Story = {
  name: "0件",
  args: { ...base, summaries: [], sortedSummaries: [] },
  parameters: { a11y: { test: "error" } },
};
export const Loading: Story = {
  name: "読み込み中",
  args: { ...base, pending: true, summaries: [], sortedSummaries: [] },
  parameters: { a11y: { test: "error" } },
};

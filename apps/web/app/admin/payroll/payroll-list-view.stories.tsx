import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AdminMonthlyPayrollSummaryState } from "../../../lib/admin-attendance-types";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { AdminShellView } from "../_components/admin-shell-view";
import { PayrollListView } from "./payroll-list-view";

const users: AdminUsersState = {
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
const clearSummary: AdminMonthlyPayrollSummaryState = {
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
const warningSummary: AdminMonthlyPayrollSummaryState = {
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
  title: "Admin/給与一覧",
  component: PayrollListView,
  decorators: [
    (Story) => (
      <AdminShellView pathname="/admin/payroll" isAuthReady>
        {Story()}
      </AdminShellView>
    ),
  ],
} satisfies Meta<typeof PayrollListView>;
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
};
export const 要確認を含む: Story = {
  args: {
    ...base,
    summaries: [...clearSummary.data, ...warningSummary.data],
    sortedSummaries: [...clearSummary.data, ...warningSummary.data],
  },
};
export const Empty: Story = {
  name: "0件",
  args: { ...base, summaries: [], sortedSummaries: [] },
};

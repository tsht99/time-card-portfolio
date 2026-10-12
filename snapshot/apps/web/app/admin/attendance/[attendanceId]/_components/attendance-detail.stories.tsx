import type { AdminAttendanceDetail } from "@repo/contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { AdminShellView } from "../../../_components/admin-shell-view";
import type { AdminUserListState } from "../../../_lib/admin-user-management-types.ts";
import { AttendanceDetailView } from "./attendance-detail-view.tsx";

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const displayName = `LongDisplayName${"A".repeat(80)}`;
const detail: AdminAttendanceDetail = {
  attendanceId: "attendance-fixture",
  eventVersion: 2,
  attendanceDate: "2026-09-03",
  userId: "staff-fixture",
  displayName,
  workPeriod: "day",
  clockInAt: "2026-09-03T00:15:00.000Z",
  clockOutAt: "2026-09-03T09:00:00.000Z",
  workedMinutes: 525,
  status: "completed",
  payrollEstimate: {
    hourlyWage: 1200,
    estimatedPayYen: 10500,
    status: "calculated",
  },
  history: [],
};
const users: AdminUserListState = {
  status: "ready",
  data: [
    {
      userId: "admin-fixture",
      displayName: "管理者",
      role: "admin",
      status: "active",
    },
    {
      userId: "staff-fixture",
      displayName,
      role: "staff",
      status: "active",
    },
  ],
};

const meta = {
  title: "Admin/勤怠詳細",
  component: AttendanceDetailView,
  decorators: [
    (Story) => (
      <AdminShellView
        pathname="/admin/attendance/attendance-fixture"
        isAuthReady
      >
        <main className="w-full min-w-0 p-4">
          <Story />
        </main>
      </AdminShellView>
    ),
  ],
  args: {
    detail,
    initialUsers: users,
    correctionHref: "/admin/attendance/attendance-fixture/edit",
    canEdit: true,
    isCancellationOpen: false,
    isCancelling: false,
    operationErrorMessage: null,
    operationErrorKind: null,
    onOpenCancellation: () => undefined,
    onOpenChange: () => undefined,
    onConfirmCancellation: () => undefined,
  },
} satisfies Meta<typeof AttendanceDetailView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 勤怠詳細と取消確認: Story = {
  play: async () => {
    await page.viewport(390, 844);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    const header = required(document.querySelector("header"), "header");
    const navigation = required(
      document.querySelector('[aria-label="管理画面のメインナビゲーション"]'),
      "admin navigation",
    );
    const frame = header.nextElementSibling as HTMLElement;
    const headerBox = header.getBoundingClientRect();
    const navBox = navigation.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    expect(Math.abs(navBox.x - headerBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(navBox.width - headerBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(frameBox.x - headerBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frameBox.width - headerBox.width)).toBeLessThanOrEqual(1);
    expect(frameBox.width).toBeLessThanOrEqual(448);
    expect(
      Math.abs(frameBox.x - (390 - frameBox.width) / 2),
    ).toBeLessThanOrEqual(1);
    const userContext = document.querySelector('[aria-label="対象ユーザー"]');
    const summary = document.querySelector(
      '[aria-labelledby="attendance-detail-summary"]',
    );
    expect(userContext).not.toBeNull();
    expect(summary).not.toBeNull();
    for (const element of [userContext, summary]) {
      const rect = required(element, "element").getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(390);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  },
};

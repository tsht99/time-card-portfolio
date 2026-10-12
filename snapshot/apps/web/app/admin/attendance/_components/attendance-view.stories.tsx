import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { AdminShellView } from "../../_components/admin-shell-view";
import type { AdminUserListState } from "../../_lib/admin-user-management-types.ts";
import type { AttendanceFilters } from "../_lib/admin-attendance-filters";
import type { AdminAttendanceViewState } from "../_lib/admin-attendance-types.ts";
import { AttendanceView } from "./attendance-view.tsx";

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const appliedFilters: AttendanceFilters = {
  startAttendanceDateInclusive: "2026-09-01",
  endAttendanceDateInclusive: "2026-09-30",
  userId: "",
  workPeriod: "",
  status: "",
};
const initialUsers: AdminUserListState = {
  status: "ready",
  data: [
    {
      userId: "staff-fiction-1",
      displayName: "山田 花子",
      role: "staff",
      status: "active",
    },
  ],
};
const attendance: AdminAttendanceViewState = {
  status: "ready",
  data: {
    attendance: [
      {
        attendanceId: "attendance-fiction-1",
        eventVersion: 1,
        attendanceDate: "2026-09-28",
        userId: "staff-fiction-1",
        displayName: "山田 花子",
        workPeriod: "day",
        clockInAt: "2026-09-28T09:00:00+09:00",
        clockOutAt: "2026-09-28T17:30:00+09:00",
        workedMinutes: 510,
        status: "completed",
      },
    ],
    cancelledAttendance: [
      {
        attendanceId: "attendance-fiction-cancelled",
        attendanceDate: "2026-09-27",
        userId: "staff-fiction-1",
        displayName: "山田 花子",
        workPeriod: "night",
        clockInAt: "2026-09-27T22:00:00+09:00",
      },
    ],
  },
};
const meta = {
  title: "Admin/勤怠一覧",
  component: AttendanceView,
  decorators: [
    (Story) => (
      <NuqsTestingAdapter>
        <AdminShellView pathname="/admin/attendance" isAuthReady>
          {Story()}
        </AdminShellView>
      </NuqsTestingAdapter>
    ),
  ],
} satisfies Meta<typeof AttendanceView>;
export default meta;
type Story = StoryObj<typeof meta>;
const base = {
  authState: { status: "ready" as const, message: "" },
  appliedFilters,
  initialUsers,
};
export const 通常の勤怠あり: Story = {
  args: {
    ...base,
    initialAttendance: attendance,
  },
  parameters: { a11y: { test: "error" } },
};
export const Empty: Story = {
  name: "0件",
  args: {
    ...base,
    initialAttendance: {
      status: "ready",
      data: { attendance: [], cancelledAttendance: [] },
    },
  },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    await page.viewport(320, 844);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    expect(document.body.scrollWidth).toBeLessThanOrEqual(320);
    const empty = canvasElement.querySelector("p");
    const createLink = canvasElement.querySelector(
      'a[aria-label="勤怠を新規作成"]',
    );
    expect(empty).not.toBeNull();
    expect(createLink).not.toBeNull();
    expect(
      required(createLink, "create link").getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(
      required(empty, "empty message").getBoundingClientRect().bottom,
    );
    const box = required(createLink, "create link").getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(320);
  },
};
export const 取消済みを含む: Story = {
  args: {
    ...base,
    initialAttendance: attendance,
  },
  parameters: { a11y: { test: "error" } },
};
export const 狭幅検索条件と長い候補: Story = {
  args: {
    ...base,
    initialUsers: {
      status: "ready",
      data: [
        {
          userId: "staff-long-name",
          displayName: `検索候補-${"長いスタッフ表示名".repeat(8)}`,
          role: "staff",
          status: "active",
        },
      ],
    },
    initialAttendance: {
      status: "ready",
      data: { attendance: [], cancelledAttendance: [] },
    },
  },
  parameters: { a11y: { test: "error" } },
  play: async () => {
    await page.viewport(390, 844);
    await page.getByRole("button", { name: "検索条件を開く" }).click();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    await page.getByRole("combobox", { name: "利用者" }).click();
    const option = page.getByRole("option", {
      name: `検索候補-${"長いスタッフ表示名".repeat(8)}`,
      exact: true,
    });
    await expect(option).toBeVisible();
    const rect = option.element().getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  },
};

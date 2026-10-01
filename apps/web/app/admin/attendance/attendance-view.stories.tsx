import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AttendanceFilters } from "../../../lib/admin-attendance-filters";
import type {
  AdminAttendanceListState,
  AdminCancelledAttendanceListState,
} from "../../../lib/admin-attendance-types";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { AdminShellView } from "../_components/admin-shell-view";
import { AttendanceView } from "./attendance-view";

const appliedFilters: AttendanceFilters = {
  startAttendanceDateInclusive: "2026-09-01",
  endAttendanceDateInclusive: "2026-09-30",
  userId: "",
  workPeriod: "",
  status: "",
};
const initialUsers: AdminUsersState = {
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
const attendance: AdminAttendanceListState = {
  status: "ready",
  data: [
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
};
const cancelled: AdminCancelledAttendanceListState = {
  status: "ready",
  data: [
    {
      attendanceId: "attendance-fiction-cancelled",
      attendanceDate: "2026-09-27",
      userId: "staff-fiction-1",
      displayName: "山田 花子",
      workPeriod: "night",
      clockInAt: "2026-09-27T22:00:00+09:00",
    },
  ],
};
const meta = {
  title: "Admin/勤怠一覧",
  component: AttendanceView,
  decorators: [
    (Story) => (
      <AdminShellView pathname="/admin/attendance" isAuthReady>
        {Story()}
      </AdminShellView>
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
    initialCancelledAttendance: { status: "ready", data: [] },
  },
};
export const Empty: Story = {
  name: "0件",
  args: {
    ...base,
    initialAttendance: { status: "ready", data: [] },
    initialCancelledAttendance: { status: "ready", data: [] },
  },
};
export const 取消済みを含む: Story = {
  args: {
    ...base,
    initialAttendance: attendance,
    initialCancelledAttendance: cancelled,
  },
};

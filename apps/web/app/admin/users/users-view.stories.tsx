import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { AdminShellView } from "../_components/admin-shell-view";
import { UsersView } from "./users-view";

const users: AdminUsersState = {
  status: "ready",
  data: [
    {
      userId: "admin-fiction-1",
      displayName: "管理者 花子",
      role: "admin",
      status: "active",
    },
    {
      userId: "staff-fiction-active",
      displayName: "利用中スタッフ",
      role: "staff",
      status: "active",
    },
    {
      userId: "staff-fiction-pending",
      displayName: "承認待ちスタッフ",
      role: "staff",
      status: "pending",
    },
    {
      userId: "staff-fiction-inactive",
      displayName: "利用停止スタッフ",
      role: "staff",
      status: "inactive",
    },
  ],
};
const meta = {
  title: "Admin/ユーザー一覧",
  component: UsersView,
  decorators: [
    (Story) => (
      <AdminShellView pathname="/admin/users" isAuthReady>
        {Story()}
      </AdminShellView>
    ),
  ],
} satisfies Meta<typeof UsersView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Adminと各状態のStaff: Story = {
  args: { authState: { status: "ready", message: "" }, initialUsers: users },
};
export const Staffが0人: Story = {
  args: {
    authState: { status: "ready", message: "" },
    initialUsers: {
      status: "ready",
      data: users.data.filter((user) => user.role === "admin"),
    },
  },
};

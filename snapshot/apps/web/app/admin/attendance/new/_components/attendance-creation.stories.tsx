import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useForm } from "react-hook-form";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { AdminShellView } from "../../../_components/admin-shell-view";
import type { AdminUserListState } from "../../../_lib/admin-user-management-types.ts";
import type {
  CreationForm,
  CreationFormOutput,
} from "./attendance-creation.tsx";
import { AttendanceCreationView } from "./attendance-creation-view.tsx";

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const users: AdminUserListState = {
  status: "ready",
  data: [
    {
      userId: "attendance-target",
      displayName: `新規作成対象-${"長い名前".repeat(8)}`,
      role: "staff" as const,
      status: "active" as const,
    },
  ],
};

function AttendanceCreationFixture({
  initialUsers,
}: {
  initialUsers: AdminUserListState;
}) {
  const creationForm = useForm<CreationForm, unknown, CreationFormOutput>({
    defaultValues: {
      userId: "",
      workPeriod: "",
      clockInAt: "",
      clockOutAt: "",
    },
  });
  return (
    <AttendanceCreationView
      authState={{ status: "ready", user: { userId: "admin-fixture" } }}
      initialUsers={initialUsers}
      creationCandidates={
        initialUsers.status === "ready"
          ? initialUsers.data.filter((user) => user.userId !== "admin-fixture")
          : []
      }
      creationForm={creationForm}
      isPending={false}
      mutationError={null}
      onSubmit={(event) => event.preventDefault()}
    />
  );
}

const meta = {
  title: "Admin/勤怠作成",
  component: AttendanceCreationFixture,
  decorators: [
    (Story) => (
      <AdminShellView pathname="/admin/attendance/new" isAuthReady>
        <Story />
      </AdminShellView>
    ),
  ],
  args: { initialUsers: users },
} satisfies Meta<typeof AttendanceCreationFixture>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 通常: Story = {
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    for (const width of [390, 1280]) {
      await page.viewport(width, 900);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
      const main = canvasElement.querySelector("main");
      expect(main).not.toBeNull();
      expect(
        required(main, "main").getBoundingClientRect().right,
      ).toBeLessThanOrEqual(width);
      expect(canvasElement.querySelector("form")).not.toBeNull();
    }
  },
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { AdminShellView } from "../../../_components/admin-shell-view";
import { AttendanceCancellationDialog } from "./attendance-cancellation-dialog.tsx";

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const displayName = `LongDisplayName${"A".repeat(80)}`;
const meta = {
  title: "Admin/勤怠詳細/取消Dialog",
  component: AttendanceCancellationDialog,
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
    isOpen: true,
    displayName,
    attendanceDate: "2026-09-28",
    workPeriod: "day",
    onOpenChange: () => undefined,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof AttendanceCancellationDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 長い表示名: Story = {
  parameters: { a11y: { test: "error" } },
  play: async () => {
    await page.viewport(390, 844);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const details = required(dialog, "dialog").querySelector("dl");
    const displayNameElement = details?.querySelector("dd");
    const buttons = Array.from(
      required(dialog, "dialog").querySelectorAll(
        "[data-slot=dialog-footer] button",
      ),
    );
    expect(displayNameElement?.textContent).toBe(displayName);
    expect(
      required(displayNameElement, "displayNameElement").scrollWidth,
    ).toBeLessThanOrEqual(
      required(displayNameElement, "displayNameElement").clientWidth,
    );
    const dialogBox = required(dialog, "dialog").getBoundingClientRect();
    const detailsBox = required(details, "details").getBoundingClientRect();
    const nameBox = required(
      displayNameElement,
      "displayNameElement",
    ).getBoundingClientRect();
    expect(dialogBox.left).toBeGreaterThanOrEqual(0);
    expect(dialogBox.right).toBeLessThanOrEqual(390);
    expect(detailsBox.left).toBeGreaterThanOrEqual(dialogBox.left);
    expect(detailsBox.right).toBeLessThanOrEqual(dialogBox.right);
    expect(nameBox.left).toBeGreaterThanOrEqual(detailsBox.left);
    expect(nameBox.right).toBeLessThanOrEqual(detailsBox.right);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(390);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(844);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  },
};

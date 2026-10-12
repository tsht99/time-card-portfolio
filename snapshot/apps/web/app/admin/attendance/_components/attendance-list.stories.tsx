import type {
  AttendanceListItem,
  CancelledAttendanceListItem,
} from "@repo/contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "vitest";
import { page } from "vitest/browser";
import { AdminShellView } from "../../_components/admin-shell-view";
import { AttendanceList } from "./attendance-list.tsx";

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label} to exist.`);
  return value;
}

const userName = `LongDisplayName${"A".repeat(80)}`;
const attendance = [
  {
    attendanceId: "two-day-clock-out-row",
    eventVersion: 2,
    attendanceDate: "2026-09-28",
    userId: "staff-two-day-clock-out",
    displayName: userName,
    workPeriod: "day",
    clockInAt: "2026-09-27T23:15:00.000Z",
    clockOutAt: "2026-10-01T18:59:00.000Z",
    workedMinutes: 3225,
    status: "completed",
  },
  {
    attendanceId: "working-row",
    eventVersion: 1,
    attendanceDate: "2026-09-28",
    userId: "staff-working",
    displayName: "勤務中スタッフ",
    workPeriod: "day",
    clockInAt: "2026-09-28T09:00:00+09:00",
    clockOutAt: null,
    workedMinutes: null,
    status: "working",
  },
  {
    attendanceId: "completed-row",
    eventVersion: 2,
    attendanceDate: "2026-09-28",
    userId: "staff-completed",
    displayName: "完了スタッフ",
    workPeriod: "night",
    clockInAt: "2026-09-28T19:00:00+09:00",
    clockOutAt: "2026-09-28T22:00:00+09:00",
    workedMinutes: 180,
    status: "completed",
  },
] satisfies AttendanceListItem[];
const cancelled = [
  {
    attendanceId: "cancelled-row",
    attendanceDate: "2026-09-28",
    userId: "staff-cancelled",
    displayName: "取消済みスタッフ",
    workPeriod: "day",
    clockInAt: "2026-09-28T08:00:00+09:00",
  },
] satisfies CancelledAttendanceListItem[];

const meta = {
  title: "Admin/勤怠一覧行",
  component: AttendanceList,
  decorators: [
    (Story) => (
      <AdminShellView pathname="/admin/attendance" isAuthReady>
        <main className="w-full min-w-0 p-4">
          <Story />
        </main>
      </AdminShellView>
    ),
  ],
} satisfies Meta<typeof AttendanceList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 長い表示名と状態別勤怠: Story = {
  args: { attendance, cancelledAttendance: cancelled, canonicalQuery: "" },
  parameters: { a11y: { test: "error" } },
  play: async ({ canvasElement }) => {
    for (const width of [320, 390, 1280]) {
      await page.viewport(width, 900);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
      const links = Array.from(
        canvasElement.querySelectorAll<HTMLAnchorElement>(
          'a[aria-label*="勤怠詳細へ移動"]',
        ),
      );
      expect(links).toHaveLength(4);
      const longNameLink = links.find((link) =>
        link.textContent?.includes(userName),
      );
      const longName = longNameLink?.querySelector("span");
      const expectedLongNameLabel = `2026/09/28 ${userName} 昼 08:15 - 99:59 勤怠詳細へ移動`;
      expect(longName).not.toBeNull();
      expect(required(longName, "longName").textContent).toBe(userName);
      expect(longNameLink).not.toBeUndefined();
      expect(longNameLink?.getAttribute("aria-label")).toBe(
        expectedLongNameLabel,
      );
      expect(longNameLink?.textContent).not.toContain("2026/10/02");
      expect(longNameLink?.textContent).toContain("99:59");
      expect(
        required(longName, "longName").getBoundingClientRect().right,
      ).toBeLessThanOrEqual(width);
      const activeLinks = links.filter(
        (link) => !link.textContent?.includes("取消済み"),
      );
      const cells = activeLinks.map((link) =>
        link.querySelector<HTMLElement>("[data-attendance-time-cell]"),
      );
      expect(cells.every(Boolean)).toBe(true);
      const [workingCell, completedCell] = cells.map((cell) =>
        required(cell, "cell").getBoundingClientRect(),
      );
      expect(
        Math.abs(
          required(workingCell, "workingCell").x -
            required(completedCell, "completedCell").x,
        ),
      ).toBeLessThanOrEqual(0.75);
      expect(
        Math.abs(
          required(workingCell, "workingCell").width -
            required(completedCell, "completedCell").width,
        ),
      ).toBeLessThanOrEqual(0.75);
      const parts = (link: HTMLAnchorElement) =>
        ["clock-in", "separator", "clock-out"].map((part) =>
          link
            .querySelector<HTMLElement>(`[data-attendance-time-part="${part}"]`)
            ?.getBoundingClientRect(),
        );
      const workingParts = parts(required(activeLinks[0], "activeLinks[0]"));
      const completedParts = parts(required(activeLinks[1], "activeLinks[1]"));
      for (const [index, workingPart] of workingParts.entries()) {
        const completedPart = completedParts[index];
        expect(workingPart).toBeDefined();
        expect(completedPart).toBeDefined();
        expect(
          Math.abs(
            required(workingPart, "workingPart").x -
              required(completedPart, "completedPart").x,
          ),
        ).toBeLessThanOrEqual(0.75);
        expect(
          Math.abs(
            required(workingPart, "workingPart").width -
              required(completedPart, "completedPart").width,
          ),
        ).toBeLessThanOrEqual(0.75);
      }
      const cancelledLink = links.find((link) =>
        link.textContent?.includes("取消済み"),
      );
      expect(required(cancelledLink, "cancelledLink").textContent).toContain(
        "取消済み",
      );
    }
  },
};

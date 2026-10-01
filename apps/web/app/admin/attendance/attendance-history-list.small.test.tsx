import type { AttendanceEventHistoryItem, UserListItem } from "@repo/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { AttendanceHistoryList } from "./attendance-history-list";

const event: AttendanceEventHistoryItem = {
  eventId: "event-1",
  attendanceId: "attendance-1",
  eventVersion: 1,
  performedByUserId: "admin-1",
  createdAt: "2026-09-03T09:20:00.000Z",
  eventType: "AttendanceClockedIn",
  payload: {
    userId: "staff-1",
    attendanceDate: "2026-09-03",
    workPeriod: "day",
    clockInAt: "2026-09-03T09:15:00.000Z",
  },
};

const baseUsers: UserListItem[] = [
  {
    userId: "admin-1",
    displayName: "変更前の管理者名",
    role: "admin",
    status: "active",
  },
];

afterEach(() => cleanup());

describe("AttendanceHistoryList", () => {
  test("同じperformedByUserIdの現在の表示名を履歴へ反映する", () => {
    const { rerender } = render(
      <AttendanceHistoryList events={[event]} users={baseUsers} />,
    );
    expect(screen.getByText("操作者：変更前の管理者名")).toBeTruthy();

    rerender(
      <AttendanceHistoryList
        events={[event]}
        users={[{ ...baseUsers[0], displayName: "変更後の管理者名" }]}
      />,
    );
    expect(screen.getByText("操作者：変更後の管理者名")).toBeTruthy();
    expect(screen.queryByText("操作者：変更前の管理者名")).toBeNull();
  });

  test("displayNameがnullから設定された場合も現在の表示名を表示する", () => {
    const { rerender } = render(
      <AttendanceHistoryList
        events={[event]}
        users={[{ ...baseUsers[0], displayName: null }]}
      />,
    );
    expect(screen.getByText("操作者：名前未設定")).toBeTruthy();

    rerender(
      <AttendanceHistoryList
        events={[event]}
        users={[{ ...baseUsers[0], displayName: "設定後の管理者名" }]}
      />,
    );
    expect(screen.getByText("操作者：設定後の管理者名")).toBeTruthy();
  });
});

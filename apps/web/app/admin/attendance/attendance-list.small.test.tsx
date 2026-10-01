import type {
  AttendanceListItem,
  CancelledAttendanceListItem,
} from "@repo/contracts";
import { within } from "@testing-library/dom";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AttendanceList } from "./attendance-list";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const baseItem: AttendanceListItem = {
  attendanceId: "attendance-1",
  eventVersion: 4,
  attendanceDate: "2026-09-03",
  userId: "staff-1",
  displayName: "有効スタッフ",
  workPeriod: "day",
  clockInAt: "2026-09-03T09:15:00+09:00",
  clockOutAt: "2026-09-03T18:00:00+09:00",
  workedMinutes: 525,
  status: "completed",
};

const cancelledItem: CancelledAttendanceListItem = {
  attendanceId: "cancelled-attendance",
  attendanceDate: "2026-09-04",
  userId: "staff-2",
  displayName: "取消済みスタッフ",
  workPeriod: "night",
  clockInAt: "2026-09-04T22:15:00+09:00",
};

function renderList(
  attendance: AttendanceListItem[] = [],
  cancelledAttendance: CancelledAttendanceListItem[] = [],
) {
  return render(
    <AttendanceList
      attendance={attendance}
      cancelledAttendance={cancelledAttendance}
      canonicalQuery="from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=day&status=completed"
    />,
  );
}

function getAttendanceLinks() {
  return screen.getAllByRole("link", { name: /勤怠詳細へ移動/ });
}

afterEach(() => cleanup());

describe("AttendanceList", () => {
  test("勤務日昇順、利用者と勤務区分をまたぐ出勤時刻降順、取消混在、同時刻のID順で表示する", () => {
    renderList(
      [
        {
          ...baseItem,
          attendanceId: "z-latest",
          userId: "staff-z",
          workPeriod: "day",
          displayName: "遅い出勤",
          clockInAt: "2026-09-03T18:00:00+09:00",
        },
        {
          ...baseItem,
          attendanceId: "b-tie",
          userId: "staff-a",
          workPeriod: "night",
          displayName: "同時刻B",
          clockInAt: "2026-09-03T12:00:00+09:00",
        },
        {
          ...baseItem,
          attendanceId: "a-tie",
          userId: "staff-z",
          workPeriod: "day",
          displayName: "同時刻A",
          clockInAt: "2026-09-03T12:00:00+09:00",
        },
        {
          ...baseItem,
          attendanceId: "z-older-date",
          attendanceDate: "2026-09-02",
          displayName: "前日",
        },
      ],
      [
        {
          ...cancelledItem,
          attendanceId: "cancelled-middle",
          userId: "staff-a",
          workPeriod: "night",
          displayName: "取消中間",
          attendanceDate: "2026-09-03",
          clockInAt: "2026-09-03T15:00:00+09:00",
        },
      ],
    );

    const list = screen.getByRole("list", { name: "勤怠一覧" });
    expect(
      within(list)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["2026/09/02", "2026/09/03"]);
    expect(within(list).getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(screen.getByRole("region", { name: "勤怠一覧" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "勤怠一覧" })).toBeNull();
    expect(
      within(
        within(list).getByRole("list", { name: "2026/09/03" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(4);
    expect(getAttendanceLinks().map((link) => link.textContent)).toEqual([
      expect.stringContaining("前日"),
      expect.stringContaining("遅い出勤"),
      expect.stringContaining("取消中間"),
      expect.stringContaining("同時刻A"),
      expect.stringContaining("同時刻B"),
    ]);
    expect(getAttendanceLinks()).toHaveLength(5);
    const createLink = screen.getByRole("link", { name: "勤怠を新規作成" });
    expect(createLink.getAttribute("href")).toBe("/admin/attendance/new");
    expect(createLink.textContent).toBe("");
    expect(createLink.parentElement?.className).toContain("justify-center");
    const lastAttendanceLink = getAttendanceLinks().at(-1);
    expect(lastAttendanceLink).toBeTruthy();
    expect(
      createLink.compareDocumentPosition(
        lastAttendanceLink as HTMLAnchorElement,
      ) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("勤怠が0件でも一覧メッセージの後ろに新規作成導線を表示する", () => {
    renderList();
    const emptyMessage = screen.getByText("この期間の勤怠はありません。");
    const createLink = screen.getByRole("link", { name: "勤怠を新規作成" });
    expect(createLink.getAttribute("href")).toBe("/admin/attendance/new");
    expect(
      emptyMessage.compareDocumentPosition(createLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("昼夜の勤務区分を表示する", () => {
    renderList([baseItem], [cancelledItem]);

    expect(screen.getByText("有効スタッフ")).toBeTruthy();
    expect(screen.getByText("取消済みスタッフ")).toBeTruthy();
    expect(screen.getByText("昼")).toBeTruthy();
    expect(screen.getByText("夜")).toBeTruthy();
  });

  test("通常退勤・勤務中・取消済みを確定した表示で区別する", () => {
    renderList(
      [
        baseItem,
        {
          ...baseItem,
          attendanceId: "working-attendance",
          displayName: "勤務中スタッフ",
          clockOutAt: null,
          workedMinutes: null,
          status: "working",
        },
        {
          ...baseItem,
          attendanceId: "missing-clock-out",
          displayName: "欠落スタッフ",
          clockOutAt: null,
          status: "completed",
        },
      ],
      [cancelledItem],
    );

    const completedLink = screen.getByRole("link", {
      name: "2026/09/03 有効スタッフ 昼 09:15 - 18:00 勤怠詳細へ移動",
    });
    expect(
      completedLink.querySelector('[data-attendance-time-part="clock-in"]')
        ?.textContent,
    ).toBe("09:15");
    expect(
      completedLink.querySelector('[data-attendance-time-part="separator"]')
        ?.textContent,
    ).toBe("-");
    expect(
      completedLink.querySelector('[data-attendance-time-part="clock-out"]')
        ?.textContent,
    ).toBe("18:00");
    expect(
      completedLink.querySelector("[data-attendance-time-cell]"),
    ).toBeTruthy();
    for (const name of ["勤務中スタッフ", "欠落スタッフ"]) {
      const workingLink = screen.getByRole("link", {
        name: `2026/09/03 ${name} 昼 09:15 - 勤務中 勤怠詳細へ移動`,
      });
      expect(
        workingLink.querySelector('[data-attendance-time-part="clock-in"]')
          ?.textContent,
      ).toBe("09:15");
      expect(
        workingLink.querySelector('[data-attendance-time-part="separator"]')
          ?.textContent,
      ).toBe("-");
      expect(
        workingLink.querySelector('[data-attendance-time-part="clock-out"]')
          ?.textContent,
      ).toBe("");
      expect(
        workingLink.querySelector("[data-attendance-time-cell]"),
      ).toBeTruthy();
      expect(workingLink.getAttribute("aria-label")).toContain(
        "09:15 - 勤務中",
      );
    }
    expect(screen.queryByText(/退勤時刻未記録|未入力/)).toBeNull();
    expect(screen.getByText("取消済み")).toBeTruthy();

    const cancelledLink = screen.getByRole("link", {
      name: "2026/09/04 取消済みスタッフ 夜 取消済み 勤怠詳細へ移動",
    });
    expect(cancelledLink.getAttribute("aria-label")).not.toContain("22:15");
    expect(cancelledLink.getAttribute("aria-label")).toContain("取消済み");
    expect(
      cancelledLink.querySelector("[data-attendance-time-cell]"),
    ).toBeTruthy();
  });

  test("当日と翌々日以降は時刻のみ、翌日退勤は24時間超で表示する", () => {
    renderList([
      baseItem,
      {
        ...baseItem,
        attendanceId: "next-day-attendance",
        displayName: "翌日スタッフ",
        clockOutAt: "2026-09-04T01:00:00+09:00",
      },
      {
        ...baseItem,
        attendanceId: "later-day-attendance",
        displayName: "翌々日スタッフ",
        clockOutAt: "2026-09-05T18:00:00+09:00",
      },
    ]);

    const completedSameDay = screen.getByRole("link", {
      name: "2026/09/03 有効スタッフ 昼 09:15 - 18:00 勤怠詳細へ移動",
    });
    expect(
      completedSameDay.querySelector('[data-attendance-time-part="clock-out"]')
        ?.textContent,
    ).toBe("18:00");

    const nextDay = screen.getByRole("link", {
      name: "2026/09/03 翌日スタッフ 昼 09:15 - 25:00 勤怠詳細へ移動",
    });
    expect(nextDay?.textContent).toContain("25:00");
    expect(nextDay.getAttribute("aria-label")).toContain("09:15 - 25:00");

    const laterDay = screen.getByRole("link", {
      name: "2026/09/03 翌々日スタッフ 昼 09:15 - 18:00 勤怠詳細へ移動",
    });
    expect(
      laterDay.querySelector('[data-attendance-time-part="clock-out"]')
        ?.textContent,
    ).toBe("18:00");
    expect(laterDay.getAttribute("aria-label")).toContain("09:15 - 18:00");
    expect(laterDay.getAttribute("aria-label")).not.toContain("2026/09/05");
    expect(laterDay.textContent).not.toContain("2026/09/05");
  });

  test("長いスタッフ名を詳細リンクのaccessible nameに含める", () => {
    const displayName = "非常に長いスタッフ表示名を持つ利用者";
    renderList([{ ...baseItem, displayName }]);

    const link = screen.getByRole("link", {
      name: new RegExp(`${displayName}.*勤怠詳細へ移動`),
    });
    expect(link.getAttribute("aria-label")).toContain(displayName);
  });

  test("各行はattendanceIdとcanonical queryを持つ詳細リンクになる", () => {
    renderList([baseItem], [cancelledItem]);

    const links = getAttendanceLinks();
    expect(links[0]?.getAttribute("href")).toBe(
      "/admin/attendance/attendance-1?from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=day&status=completed",
    );
    expect(links[1]?.getAttribute("href")).toBe(
      "/admin/attendance/cancelled-attendance?from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=day&status=completed",
    );
    for (const link of links) {
      expect(link.querySelector("a, button")).toBeNull();
    }
  });

  test("空配列では空メッセージを表示する", () => {
    renderList();
    expect(screen.getByRole("region", { name: "勤怠一覧" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "勤怠一覧" })).toBeNull();
    expect(screen.getByText("この期間の勤怠はありません。")).toBeTruthy();
  });

  test("一覧には旧inline操作UIと独立した詳細リンクを表示しない", () => {
    renderList([baseItem], [cancelledItem]);
    const list = screen.getByRole("list", { name: "勤怠一覧" });
    expect(within(list).queryByText("詳細と操作")).toBeNull();
    expect(within(list).queryByRole("link", { name: "詳細を見る" })).toBeNull();
    for (const name of ["履歴", "訂正", "取消"]) {
      expect(within(list).queryByRole("button", { name })).toBeNull();
    }
    expect(list.querySelector("dl")).toBeNull();
  });
});

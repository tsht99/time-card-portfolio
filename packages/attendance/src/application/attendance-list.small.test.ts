import { deepStrictEqual } from "node:assert/strict";
import test from "node:test";
import type { AttendanceCurrentState } from "./attendance-current-state.ts";
import {
  buildAttendanceList,
  summarizeCurrentState,
} from "./attendance-list.ts";

const state: AttendanceCurrentState = {
  attendanceId: "attendance-1",
  userId: "user-1",
  attendanceDate: "2026-08-22",
  workPeriod: "day",
  clockInAt: new Date("2026-08-22T00:00:00Z"),
  clockOutAt: new Date("2026-08-22T09:00:00Z"),
  eventVersion: 1,
  isCancelled: false,
};

test("summarizeCurrentStateは既知時刻のstateをDTO化する", () => {
  deepStrictEqual(summarizeCurrentState(state), {
    attendanceId: "attendance-1",
    eventVersion: 1,
    attendanceDate: "2026-08-22",
    workPeriod: "day",
    clockInAt: "2026-08-22T00:00:00.000Z",
    clockOutAt: "2026-08-22T09:00:00.000Z",
    workedMinutes: 540,
  });
});

test("summarizeCurrentStateは勤務中stateの退勤と労働時間をnullにする", () => {
  deepStrictEqual(summarizeCurrentState({ ...state, clockOutAt: null }), {
    attendanceId: "attendance-1",
    eventVersion: 1,
    attendanceDate: "2026-08-22",
    workPeriod: "day",
    clockInAt: "2026-08-22T00:00:00.000Z",
    clockOutAt: null,
    workedMinutes: null,
  });
});

const users = [
  { userId: "user-1", displayName: "User 1" },
  { userId: "user-2", displayName: "User 2" },
];

function listState(
  overrides: Partial<AttendanceCurrentState> = {},
): AttendanceCurrentState {
  return {
    ...state,
    ...overrides,
  };
}

test("buildAttendanceListはlegacy workDateではなくattendanceDateを基準にする", () => {
  const items = buildAttendanceList(
    [
      listState({
        attendanceId: "attendance-25-late",
        attendanceDate: "2026-08-25",
      }),
      listState({
        attendanceId: "attendance-24-legacy",
        attendanceDate: "2026-08-24",
      }),
      listState({
        attendanceId: "attendance-26-late",
        attendanceDate: "2026-08-26",
        clockOutAt: null,
      }),
      listState({
        attendanceId: "attendance-other-user",
        attendanceDate: "2026-08-25",
        userId: "user-2",
      }),
      listState({
        attendanceId: "attendance-other-period",
        attendanceDate: "2026-08-25",
        workPeriod: "night",
      }),
    ],
    users,
    {
      startAttendanceDateInclusive: "2026-08-25",
      endAttendanceDateInclusive: "2026-08-26",
    },
  );

  deepStrictEqual(
    items.map(({ attendanceId, attendanceDate }) => ({
      attendanceId,
      attendanceDate,
    })),
    [
      { attendanceId: "attendance-25-late", attendanceDate: "2026-08-25" },
      { attendanceId: "attendance-other-period", attendanceDate: "2026-08-25" },
      { attendanceId: "attendance-other-user", attendanceDate: "2026-08-25" },
      { attendanceId: "attendance-26-late", attendanceDate: "2026-08-26" },
    ],
  );
  deepStrictEqual(
    buildAttendanceList([listState({ attendanceDate: "2026-08-25" })], users, {
      startAttendanceDateInclusive: "2026-08-24",
      endAttendanceDateInclusive: "2026-08-24",
    }),
    [],
  );
});

test("buildAttendanceListのuserId・workPeriod・statusフィルタを維持する", () => {
  const items = buildAttendanceList(
    [
      listState({ attendanceId: "user-1-day-working", clockOutAt: null }),
      listState({
        attendanceId: "user-1-night-completed",
        workPeriod: "night",
      }),
      listState({ attendanceId: "user-2-day-completed", userId: "user-2" }),
    ],
    users,
    {
      startAttendanceDateInclusive: "2026-08-22",
      endAttendanceDateInclusive: "2026-08-22",
      userId: "user-1",
      workPeriod: "day",
      status: "working",
    },
  );

  deepStrictEqual(
    items.map((item) => item.attendanceId),
    ["user-1-day-working"],
  );
});

test("同一ユーザー・勤務日・勤務区分の複数勤怠を独立した一覧itemとして残す", () => {
  const items = buildAttendanceList(
    [
      listState({ attendanceId: "day-1" }),
      listState({ attendanceId: "day-2" }),
    ],
    users,
    {
      startAttendanceDateInclusive: "2026-08-22",
      endAttendanceDateInclusive: "2026-08-22",
    },
  );

  deepStrictEqual(
    items.map((item) => item.attendanceId),
    ["day-1", "day-2"],
  );
});

test("buildAttendanceListはclockOutAtからworking/completedとstatusを導出する", () => {
  const items = buildAttendanceList(
    [
      listState({
        attendanceId: "pending",
        clockOutAt: null,
      }),
      listState({ attendanceId: "recorded" }),
    ],
    users,
    {
      startAttendanceDateInclusive: "2026-08-22",
      endAttendanceDateInclusive: "2026-08-22",
    },
  );
  deepStrictEqual(
    items.map(({ attendanceId, status, workedMinutes }) => ({
      attendanceId,
      status,
      workedMinutes,
    })),
    [
      {
        attendanceId: "pending",
        status: "working",
        workedMinutes: null,
      },
      {
        attendanceId: "recorded",
        status: "completed",
        workedMinutes: 540,
      },
    ],
  );
});

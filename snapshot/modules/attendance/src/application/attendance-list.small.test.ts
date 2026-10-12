import { deepStrictEqual } from "node:assert/strict";
import test from "node:test";
import type { AttendanceCurrentState } from "./attendance-current-state.ts";
import { summarizeCurrentState } from "./attendance-list.ts";

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

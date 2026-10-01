import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import test from "node:test";
import { AttendanceAggregate } from "../domain/attendance.ts";
import { aggregateToCurrentState } from "./attendance-current-state.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const clockInAt = new Date("2026-08-22T15:30:00.000Z");
const clockOutAt = new Date("2026-08-23T00:30:00.000Z");

function completedAggregate() {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn({
    userId,
    workPeriod: "day",
    attendanceDate: "2026-08-23",
    clockInAt,
  });
  aggregate.clockOut({ clockOutAt });
  return aggregate;
}

test("Aggregate replayからcurrent stateを生成する", () => {
  const state = aggregateToCurrentState(completedAggregate());

  strictEqual(state.eventVersion, 2);
  strictEqual(state.attendanceDate, "2026-08-23");
  strictEqual(state.userId, userId);
  strictEqual(state.workPeriod, "day");
  deepStrictEqual(
    { clockInAt: state.clockInAt, clockOutAt: state.clockOutAt },
    { clockInAt, clockOutAt },
  );
});

test("開始前Aggregateはcurrent stateへ投影できない", () => {
  throws(
    () => aggregateToCurrentState(AttendanceAggregate.start("attendance-1")),
    /required current-state fields/,
  );
});

test("Active AggregateのattendanceDateはclockInAtのJST日付になる", () => {
  const state = aggregateToCurrentState(completedAggregate());

  strictEqual(state.attendanceDate, "2026-08-23");
  strictEqual("workDate" in state, false);
});

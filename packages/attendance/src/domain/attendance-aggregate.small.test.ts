import assert from "node:assert/strict";
import test from "node:test";

import {
  AttendanceAggregate,
  InvalidAttendanceTransitionError,
} from "./attendance.ts";

function assertInvalidAttendanceDateTimeError(
  error: unknown,
  field: string,
): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "InvalidAttendanceDateTimeError");
  assert.equal(error.message, `Attendance ${field} must be a valid Date.`);
  return true;
}

const clockInPayload = {
  userId: "user-1",
  attendanceDate: "2026-08-22",
  workPeriod: "day" as const,
  clockInAt: new Date("2026-08-22T09:00:00.000Z"),
};

test("AttendanceClockedInから勤務中状態を復元できる", () => {
  const aggregate = AttendanceAggregate.replay([
    {
      eventType: "AttendanceClockedIn",
      eventVersion: 1,
      attendanceId: "attendance-1",
      payload: clockInPayload,
    },
  ]);

  assert.equal(aggregate.attendanceId, "attendance-1");
  assert.equal(aggregate.version, 1);
  assert.equal(aggregate.userId, "user-1");
  assert.equal("workDate" in aggregate.state, false);
  assert.equal("workDate" in aggregate, false);
  assert.equal(aggregate.attendanceDate, "2026-08-22");
  assert.equal(aggregate.workPeriod, "day");
  assert.deepEqual(aggregate.clockInAt, clockInPayload.clockInAt);
  assert.equal(aggregate.clockOutAt, null);
});

test("未打刻状態のattendanceDateはnullになる", () => {
  assert.equal(AttendanceAggregate.start("attendance-1").attendanceDate, null);
});

test("clockInAtと一致するJST日付をattendanceDateとして保持する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");

  aggregate.clockIn({
    ...clockInPayload,
    attendanceDate: "2026-08-25",
    clockInAt: new Date("2026-08-25T00:30:00.000Z"),
  });

  assert.equal(aggregate.attendanceDate, "2026-08-25");
});

test("clockInAtのJST日付と一致しないattendanceDateを拒否する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");

  assert.throws(
    () =>
      aggregate.clockIn({
        ...clockInPayload,
        attendanceDate: "2026-08-23",
      }),
    InvalidAttendanceTransitionError,
  );
  assert.equal(aggregate.version, 0);
});

test("ClockInTimeCorrectedでJST上の日付が変わるとattendanceDateも変わる", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  assert.equal(aggregate.attendanceDate, "2026-08-22");

  aggregate.correctClockInTime({
    clockInAt: new Date("2026-08-22T15:30:00.000Z"),
  });

  assert.equal(aggregate.attendanceDate, "2026-08-23");
});

test("新規clock_in payloadにworkDateを含めない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");

  const event = aggregate.clockIn(clockInPayload);

  assert.equal("workDate" in event.payload, false);
  assert.equal("workDate" in aggregate.state, false);
  assert.equal(aggregate.version, 1);
});

test("Invalid Dateのclock_inを拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  const stateBefore = aggregate.state;

  assert.throws(
    () =>
      aggregate.clockIn({ ...clockInPayload, clockInAt: new Date("invalid") }),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockInAt"),
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("Invalid Dateのclock_outを拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  const stateBefore = aggregate.state;

  assert.throws(
    () => aggregate.clockOut({ clockOutAt: new Date("invalid") }),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockOutAt"),
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("Invalid DateのclockInAt訂正を拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  const stateBefore = aggregate.state;

  assert.throws(
    () => aggregate.correctClockInTime({ clockInAt: new Date("invalid") }),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockInAt"),
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("Invalid DateのclockOutAt訂正を拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") });
  const stateBefore = aggregate.state;

  assert.throws(
    () => aggregate.correctClockOutTime({ clockOutAt: new Date("invalid") }),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockOutAt"),
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("不正なattendanceDateを含むAttendanceClockedInのreplayを拒否する", () => {
  assert.throws(
    () =>
      AttendanceAggregate.replay([
        {
          eventType: "AttendanceClockedIn",
          eventVersion: 1,
          attendanceId: "attendance-1",
          payload: { ...clockInPayload, attendanceDate: "abc" },
        },
      ]),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "InvalidAttendanceDateError");
      assert.equal(
        error.message,
        "Attendance attendanceDate must be a valid YYYY-MM-DD date: abc",
      );
      return true;
    },
  );
});

test("Invalid Dateを含む各日時イベントのreplayを拒否する", () => {
  const invalidDate = new Date("invalid");
  const validClockOut = new Date("2026-08-22T18:00:00.000Z");

  assert.throws(
    () =>
      AttendanceAggregate.replay([
        {
          eventType: "AttendanceClockedIn",
          eventVersion: 1,
          attendanceId: "attendance-1",
          payload: { ...clockInPayload, clockInAt: invalidDate },
        },
      ]),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockInAt"),
  );
  assert.throws(
    () =>
      AttendanceAggregate.replay([
        {
          eventType: "AttendanceClockedIn",
          eventVersion: 1,
          attendanceId: "attendance-1",
          payload: clockInPayload,
        },
        {
          eventType: "AttendanceClockedOut",
          eventVersion: 2,
          attendanceId: "attendance-1",
          payload: { clockOutAt: invalidDate },
        },
      ]),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockOutAt"),
  );
  assert.throws(
    () =>
      AttendanceAggregate.replay([
        {
          eventType: "AttendanceClockedIn",
          eventVersion: 1,
          attendanceId: "attendance-1",
          payload: clockInPayload,
        },
        {
          eventType: "ClockInTimeCorrected",
          eventVersion: 2,
          attendanceId: "attendance-1",
          payload: { clockInAt: invalidDate },
        },
      ]),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockInAt"),
  );
  assert.throws(
    () =>
      AttendanceAggregate.replay([
        {
          eventType: "AttendanceClockedIn",
          eventVersion: 1,
          attendanceId: "attendance-1",
          payload: clockInPayload,
        },
        {
          eventType: "AttendanceClockedOut",
          eventVersion: 2,
          attendanceId: "attendance-1",
          payload: { clockOutAt: validClockOut },
        },
        {
          eventType: "ClockOutTimeCorrected",
          eventVersion: 3,
          attendanceId: "attendance-1",
          payload: { clockOutAt: invalidDate },
        },
      ]),
    (error) => assertInvalidAttendanceDateTimeError(error, "clockOutAt"),
  );
});

test("AttendanceClockedInからAttendanceClockedOutまでを復元できる", () => {
  const aggregate = AttendanceAggregate.replay([
    {
      eventType: "AttendanceClockedOut",
      eventVersion: 2,
      attendanceId: "attendance-1",
      payload: { clockOutAt: new Date("2026-08-22T18:00:00.000Z") },
    },
    {
      eventType: "AttendanceClockedIn",
      eventVersion: 1,
      attendanceId: "attendance-1",
      payload: clockInPayload,
    },
  ]);

  assert.deepEqual(aggregate.clockOutAt, new Date("2026-08-22T18:00:00.000Z"));
  assert.equal(aggregate.version, 2);
});

test("replay後のversionは最後のeventVersionになる", () => {
  const aggregate = AttendanceAggregate.replay([
    {
      eventType: "AttendanceClockedIn",
      eventVersion: 1,
      attendanceId: "attendance-1",
      payload: clockInPayload,
    },
    {
      eventType: "AttendanceClockedOut",
      eventVersion: 2,
      attendanceId: "attendance-1",
      payload: { clockOutAt: new Date("2026-08-22T18:00:00.000Z") },
    },
  ]);
  assert.equal(aggregate.version, 2);
});

test("未出勤状態での退勤を拒否する", () => {
  assert.throws(
    () =>
      AttendanceAggregate.start("attendance-1").clockOut({
        clockOutAt: new Date(),
      }),
    InvalidAttendanceTransitionError,
  );
});

test("勤務中の再出勤を拒否する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  assert.throws(
    () => aggregate.clockIn(clockInPayload),
    InvalidAttendanceTransitionError,
  );
});

test("退勤済み後の通常打刻を拒否する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") });
  assert.throws(
    () => aggregate.clockIn(clockInPayload),
    InvalidAttendanceTransitionError,
  );
  assert.throws(
    () => aggregate.clockOut({ clockOutAt: new Date() }),
    InvalidAttendanceTransitionError,
  );
});

test("出勤後の正常な退勤と同時刻の退勤を許可する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);

  aggregate.clockOut({ clockOutAt: clockInPayload.clockInAt });
  assert.deepEqual(aggregate.clockOutAt, clockInPayload.clockInAt);
});

test("出勤時刻より前の通常退勤を拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  const stateBefore = aggregate.state;

  assert.throws(
    () =>
      aggregate.clockOut({ clockOutAt: new Date("2026-08-22T08:59:00.000Z") }),
    InvalidAttendanceTransitionError,
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("退勤前の退勤時刻訂正を拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  const stateBefore = aggregate.state;

  assert.throws(
    () =>
      aggregate.correctClockOutTime({
        clockOutAt: new Date("2026-08-22T18:00:00.000Z"),
      }),
    InvalidAttendanceTransitionError,
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("退勤済み後の退勤時刻訂正を許可する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") });

  const event = aggregate.correctClockOutTime({
    clockOutAt: new Date("2026-08-22T18:30:00.000Z"),
  });
  assert.equal(event.eventVersion, 3);
  assert.deepEqual(aggregate.clockOutAt, new Date("2026-08-22T18:30:00.000Z"));
});

test("退勤前の退勤時刻訂正をreplayすると拒否する", () => {
  assert.throws(
    () =>
      AttendanceAggregate.replay([
        {
          eventType: "AttendanceClockedIn",
          eventVersion: 1,
          attendanceId: "attendance-1",
          payload: clockInPayload,
        },
        {
          eventType: "ClockOutTimeCorrected",
          eventVersion: 2,
          attendanceId: "attendance-1",
          payload: { clockOutAt: new Date("2026-08-22T18:00:00.000Z") },
        },
      ]),
    InvalidAttendanceTransitionError,
  );
});

test("clockInAt訂正で退勤時刻より後になる変更を拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") });
  const stateBefore = aggregate.state;

  assert.throws(
    () =>
      aggregate.correctClockInTime({
        clockInAt: new Date("2026-08-22T18:01:00.000Z"),
      }),
    InvalidAttendanceTransitionError,
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("clockOutAt訂正で出勤時刻より前になる変更を拒否し、状態とversionを変更しない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") });
  const stateBefore = aggregate.state;

  assert.throws(
    () =>
      aggregate.correctClockOutTime({
        clockOutAt: new Date("2026-08-22T08:59:00.000Z"),
      }),
    InvalidAttendanceTransitionError,
  );
  assert.deepEqual(aggregate.state, stateBefore);
});

test("訂正イベントをreplayしてもuserIdとidentityは初回打刻の値から変わらない", () => {
  const clockedIn = {
    eventType: "AttendanceClockedIn" as const,
    eventVersion: 1,
    attendanceId: "attendance-1",
    payload: clockInPayload,
  };
  const clockedOut = {
    eventType: "AttendanceClockedOut" as const,
    eventVersion: 2,
    attendanceId: "attendance-1",
    payload: { clockOutAt: new Date("2026-08-22T18:00:00.000Z") },
  };
  const correctedEvents = [
    {
      eventType: "WorkPeriodCorrected" as const,
      eventVersion: 3,
      attendanceId: "attendance-1",
      payload: { workPeriod: "night" as const },
    },
    {
      eventType: "ClockOutTimeCorrected" as const,
      eventVersion: 4,
      attendanceId: "attendance-1",
      payload: { clockOutAt: new Date("2026-08-24T06:00:00.000Z") },
    },
    {
      eventType: "ClockInTimeCorrected" as const,
      eventVersion: 5,
      attendanceId: "attendance-1",
      payload: { clockInAt: new Date("2026-08-23T21:00:00.000Z") },
    },
  ];

  const aggregate = AttendanceAggregate.replay([
    ...correctedEvents.slice().reverse(),
    clockedOut,
    clockedIn,
  ]);

  assert.deepEqual(aggregate.state, {
    attendanceId: "attendance-1",
    version: 5,
    attendanceDate: "2026-08-24",
    userId: "user-1",
    workPeriod: "night",
    clockInAt: new Date("2026-08-23T21:00:00.000Z"),
    clockOutAt: new Date("2026-08-24T06:00:00.000Z"),
    isCancelled: false,
  });
  assert.deepEqual(clockedIn.payload, clockInPayload);
  assert.deepEqual(clockedOut.payload, {
    clockOutAt: new Date("2026-08-22T18:00:00.000Z"),
  });
});

test("訂正操作は同じattendanceIdでeventVersionを進め、userIdを変更できない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);

  assert.equal(
    aggregate.correctWorkPeriod({ workPeriod: "night" }).eventVersion,
    2,
  );
  assert.equal(
    aggregate.correctClockInTime({
      clockInAt: new Date("2026-08-22T09:30:00.000Z"),
    }).eventVersion,
    3,
  );
  assert.equal(
    aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") })
      .eventVersion,
    4,
  );
  assert.equal(
    aggregate.correctClockOutTime({
      clockOutAt: new Date("2026-08-22T18:30:00.000Z"),
    }).eventVersion,
    5,
  );
  assert.equal(aggregate.userId, "user-1");
  assert.equal(aggregate.version, 5);
  assert.equal(aggregate.attendanceId, "attendance-1");
});

test("コマンド入力のDateを後から変更してもAggregateの状態は変わらない", () => {
  const clockInAt = new Date("2026-08-22T09:00:00.000Z");
  const clockOutAt = new Date("2026-08-22T18:00:00.000Z");
  const aggregate = AttendanceAggregate.start("attendance-1");

  aggregate.clockIn({ ...clockInPayload, clockInAt });
  aggregate.clockOut({ clockOutAt });
  clockInAt.setTime(new Date("2026-08-22T10:00:00.000Z").getTime());
  clockOutAt.setTime(new Date("2026-08-22T19:00:00.000Z").getTime());

  assert.equal(aggregate.clockInAt?.toISOString(), "2026-08-22T09:00:00.000Z");
  assert.equal(aggregate.clockOutAt?.toISOString(), "2026-08-22T18:00:00.000Z");
  assert.equal(aggregate.version, 2);
});

test("getterとstateから取得したDateを変更してもAggregateの状態は変わらない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") });

  aggregate.clockInAt?.setTime(0);
  aggregate.clockOutAt?.setTime(0);
  const state = aggregate.state;
  state.clockInAt?.setTime(0);
  state.clockOutAt?.setTime(0);

  assert.equal(aggregate.clockInAt?.toISOString(), "2026-08-22T09:00:00.000Z");
  assert.equal(aggregate.clockOutAt?.toISOString(), "2026-08-22T18:00:00.000Z");
  assert.equal(aggregate.version, 2);
});

test("replay元eventのDateを後から変更してもAggregateの状態は変わらない", () => {
  const replayClockInAt = new Date("2026-08-22T09:00:00.000Z");
  const replayClockOutAt = new Date("2026-08-22T18:00:00.000Z");
  const events = [
    {
      eventType: "AttendanceClockedIn" as const,
      eventVersion: 1,
      attendanceId: "attendance-1",
      payload: { ...clockInPayload, clockInAt: replayClockInAt },
    },
    {
      eventType: "AttendanceClockedOut" as const,
      eventVersion: 2,
      attendanceId: "attendance-1",
      payload: { clockOutAt: replayClockOutAt },
    },
  ];
  const aggregate = AttendanceAggregate.replay(events);

  replayClockInAt.setTime(0);
  replayClockOutAt.setTime(0);

  assert.equal(aggregate.clockInAt?.toISOString(), "2026-08-22T09:00:00.000Z");
  assert.equal(aggregate.clockOutAt?.toISOString(), "2026-08-22T18:00:00.000Z");
  assert.equal(aggregate.version, 2);
});

test("勤務中のAttendanceCancelledで取消済み状態になる", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);

  const event = aggregate.cancel();

  assert.equal(event.eventType, "AttendanceCancelled");
  assert.deepEqual(event.payload, {});
  assert.equal(aggregate.isCancelled, true);
  assert.equal(aggregate.state.isCancelled, true);
  assert.equal(
    aggregate.clockInAt?.toISOString(),
    clockInPayload.clockInAt.toISOString(),
  );
});

test("退勤済みでもAttendanceCancelledで取消済み状態になる", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") });

  aggregate.cancel();

  assert.equal(aggregate.isCancelled, true);
  assert.equal(aggregate.clockOutAt?.toISOString(), "2026-08-22T18:00:00.000Z");
});

test("not_startedおよび取消済みAttendanceのAttendanceCancelledを拒否する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  assert.throws(() => aggregate.cancel(), InvalidAttendanceTransitionError);

  aggregate.clockIn(clockInPayload);
  aggregate.cancel();
  assert.throws(() => aggregate.cancel(), InvalidAttendanceTransitionError);
});

test("取消済みAttendanceの通常操作と訂正を拒否する", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  aggregate.clockIn(clockInPayload);
  aggregate.cancel();

  assert.throws(
    () =>
      aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00.000Z") }),
    InvalidAttendanceTransitionError,
  );
  assert.throws(
    () => aggregate.correctWorkPeriod({ workPeriod: "night" }),
    InvalidAttendanceTransitionError,
  );
  assert.throws(
    () =>
      aggregate.correctClockInTime({
        clockInAt: new Date("2026-08-22T09:30:00.000Z"),
      }),
    InvalidAttendanceTransitionError,
  );
  assert.throws(
    () =>
      aggregate.correctClockOutTime({
        clockOutAt: new Date("2026-08-22T18:00:00.000Z"),
      }),
    InvalidAttendanceTransitionError,
  );
});

test("correctWorkDateは公開されず、新しいWorkDateCorrectedを生成できない", () => {
  const aggregate = AttendanceAggregate.start("attendance-1");
  assert.equal("correctWorkDate" in aggregate, false);
});

test("AttendanceCancelledをreplayすると取消済み状態を復元する", () => {
  const aggregate = AttendanceAggregate.replay([
    {
      eventType: "AttendanceClockedIn",
      eventVersion: 1,
      attendanceId: "attendance-1",
      payload: clockInPayload,
    },
    {
      eventType: "AttendanceCancelled",
      eventVersion: 2,
      attendanceId: "attendance-1",
      payload: {},
    },
  ]);

  assert.deepEqual(aggregate.state, {
    attendanceId: "attendance-1",
    version: 2,
    attendanceDate: "2026-08-22",
    userId: "user-1",
    workPeriod: "day",
    clockInAt: new Date("2026-08-22T09:00:00.000Z"),
    clockOutAt: null,
    isCancelled: true,
  });
});

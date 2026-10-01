import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  AttendanceAggregate,
  InvalidAttendanceTransitionError,
} from "./attendance.ts";

const minDate = new Date("2020-01-01T00:00:00.000Z");
const maxDate = new Date("2030-01-01T00:00:00.000Z");
const dateArbitrary = fc.date({
  min: minDate,
  max: maxDate,
  noInvalidDate: true,
});

const orderedDatePairArbitrary = fc
  .tuple(dateArbitrary, dateArbitrary)
  .map(([first, second]) =>
    first.getTime() <= second.getTime()
      ? ([first, second] as const)
      : ([second, first] as const),
  );

const strictlyOrderedDatePairArbitrary = fc
  .tuple(dateArbitrary, dateArbitrary)
  .filter(([first, second]) => first.getTime() < second.getTime());

const reversedDatePairArbitrary = strictlyOrderedDatePairArbitrary.map(
  ([clockInAt, clockOutAt]) => [clockOutAt, clockInAt] as const,
);

const workPeriodArbitrary = fc.constantFrom("day" as const, "night" as const);

const completedAttendanceWithValidCorrectionArbitrary = fc
  .tuple(orderedDatePairArbitrary, workPeriodArbitrary)
  .chain(([[clockInAt, clockOutAt], workPeriod]) =>
    fc
      .date({
        min: minDate,
        max: clockOutAt,
        noInvalidDate: true,
      })
      .map((correctedClockInAt) => ({
        clockInAt,
        clockOutAt,
        correctedClockInAt,
        workPeriod,
      })),
  );

const completedAttendanceWithInvalidCorrectionArbitrary = fc
  .tuple(
    orderedDatePairArbitrary.filter(
      ([, clockOutAt]) => clockOutAt.getTime() < maxDate.getTime(),
    ),
    workPeriodArbitrary,
  )
  .chain(([[clockInAt, clockOutAt], workPeriod]) =>
    fc
      .date({
        min: new Date(clockOutAt.getTime() + 1),
        max: maxDate,
        noInvalidDate: true,
      })
      .map((correctedClockInAt) => ({
        clockInAt,
        clockOutAt,
        correctedClockInAt,
        workPeriod,
      })),
  );

function clockedInAggregate(clockInAt: Date, workPeriod: "day" | "night") {
  const aggregate = AttendanceAggregate.start("attendance-property-test");
  aggregate.clockIn({
    userId: "user-property-test",
    attendanceDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
    }).format(clockInAt),
    workPeriod,
    clockInAt,
  });
  return aggregate;
}

test("clockOutAtがclockInAt以降ならclock_outできる", () => {
  fc.assert(
    fc.property(
      orderedDatePairArbitrary,
      fc.constantFrom("day" as const, "night" as const),
      ([clockInAt, clockOutAt], workPeriod) => {
        const aggregate = clockedInAggregate(clockInAt, workPeriod);

        assert.doesNotThrow(() => aggregate.clockOut({ clockOutAt }));
        assert.equal(aggregate.version, 2);
        assert.deepEqual(aggregate.clockOutAt, clockOutAt);
      },
    ),
  );
});

test("clockOutAtがclockInAtより前ならclock_outを拒否し状態とversionを維持する", () => {
  fc.assert(
    fc.property(
      reversedDatePairArbitrary,
      fc.constantFrom("day" as const, "night" as const),
      ([clockInAt, clockOutAt], workPeriod) => {
        const aggregate = clockedInAggregate(clockInAt, workPeriod);
        const stateBefore = aggregate.state;
        const versionBefore = aggregate.version;

        assert.throws(
          () => aggregate.clockOut({ clockOutAt }),
          InvalidAttendanceTransitionError,
        );
        assert.deepEqual(aggregate.state, stateBefore);
        assert.equal(aggregate.version, versionBefore);
      },
    ),
  );
});

test("clockInとclockOutのイベントをreplayすると最終状態が一致する", () => {
  fc.assert(
    fc.property(
      orderedDatePairArbitrary,
      fc.constantFrom("day" as const, "night" as const),
      ([clockInAt, clockOutAt], workPeriod) => {
        const aggregate = AttendanceAggregate.start("attendance-property-test");
        const clockInEvent = aggregate.clockIn({
          userId: "user-property-test",
          attendanceDate: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
          }).format(clockInAt),
          workPeriod,
          clockInAt,
        });
        const clockOutEvent = aggregate.clockOut({ clockOutAt });
        const replayed = AttendanceAggregate.replay([
          clockInEvent,
          clockOutEvent,
        ]);

        assert.equal(replayed.attendanceId, aggregate.attendanceId);
        assert.equal(replayed.version, aggregate.version);
        assert.equal(replayed.userId, aggregate.userId);
        assert.equal(replayed.attendanceDate, aggregate.attendanceDate);
        assert.equal(replayed.workPeriod, aggregate.workPeriod);
        assert.deepEqual(replayed.clockInAt, aggregate.clockInAt);
        assert.deepEqual(replayed.clockOutAt, aggregate.clockOutAt);
        assert.equal(replayed.isCancelled, aggregate.isCancelled);
        assert.deepEqual(replayed.state, aggregate.state);
      },
    ),
  );
});

test("完了済みAttendanceのclockInAt訂正はclockOutAt以前なら成功しイベントと状態が一致する", () => {
  fc.assert(
    fc.property(
      completedAttendanceWithValidCorrectionArbitrary,
      ({ clockInAt, clockOutAt, correctedClockInAt, workPeriod }) => {
        const aggregate = AttendanceAggregate.start("attendance-property-test");
        const clockInEvent = aggregate.clockIn({
          userId: "user-property-test",
          attendanceDate: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
          }).format(clockInAt),
          workPeriod,
          clockInAt,
        });
        const clockOutEvent = aggregate.clockOut({ clockOutAt });

        const versionBefore = aggregate.version;
        const correctionEvent = aggregate.correctClockInTime({
          clockInAt: correctedClockInAt,
        });

        assert.equal(
          aggregate.clockInAt?.getTime(),
          correctedClockInAt.getTime(),
        );
        assert.deepEqual(aggregate.clockOutAt, clockOutAt);
        assert.equal(aggregate.version, versionBefore + 1);
        assert.equal(correctionEvent.eventType, "ClockInTimeCorrected");
        assert.equal(correctionEvent.eventVersion, aggregate.version);
        assert.deepEqual(
          correctionEvent.payload.clockInAt,
          aggregate.clockInAt,
        );

        const replayed = AttendanceAggregate.replay([
          clockInEvent,
          clockOutEvent,
          correctionEvent,
        ]);
        assert.deepEqual(replayed.state, aggregate.state);
      },
    ),
  );
});

test("完了済みAttendanceのclockInAt訂正はclockOutAtより後なら状態とversionを維持して拒否する", () => {
  fc.assert(
    fc.property(
      completedAttendanceWithInvalidCorrectionArbitrary,
      ({ clockInAt, clockOutAt, correctedClockInAt, workPeriod }) => {
        const aggregate = AttendanceAggregate.start("attendance-property-test");
        aggregate.clockIn({
          userId: "user-property-test",
          attendanceDate: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
          }).format(clockInAt),
          workPeriod,
          clockInAt,
        });
        aggregate.clockOut({ clockOutAt });
        const stateBefore = aggregate.state;
        const versionBefore = aggregate.version;

        assert.throws(
          () => aggregate.correctClockInTime({ clockInAt: correctedClockInAt }),
          InvalidAttendanceTransitionError,
        );
        assert.deepEqual(aggregate.state, stateBefore);
        assert.equal(aggregate.version, versionBefore);
      },
    ),
  );
});

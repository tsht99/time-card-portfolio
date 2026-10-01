import assert from "node:assert/strict";
import test from "node:test";

import {
  type AttendanceOverlapRecord,
  findAttendanceClockInTimeOverlap,
  findAttendanceTimeOverlap,
} from "./attendance-overlap.ts";

const userId = "user-1";

function date(value: string): Date {
  return new Date(`2026-08-22T${value}:00.000Z`);
}

function attendance(
  attendanceId: string,
  clockInAt: Date | null,
  clockOutAt: Date | null,
  options: Partial<AttendanceOverlapRecord> = {},
): AttendanceOverlapRecord {
  return {
    attendanceId,
    userId,
    workPeriod: "day",
    clockInAt,
    clockOutAt,
    ...options,
  };
}

test("半開区間は境界一致を重複としない", () => {
  const existing = attendance("b", date("10:00"), date("11:00"));
  assert.equal(
    findAttendanceTimeOverlap(attendance("a", date("09:00"), date("10:00")), [
      existing,
    ]),
    null,
  );
  assert.deepEqual(
    findAttendanceTimeOverlap(attendance("a", date("09:00"), date("10:01")), [
      existing,
    ]),
    {
      attendanceId: existing.attendanceId,
      userId: existing.userId,
      clockInAt: existing.clockInAt,
      clockOutAt: existing.clockOutAt,
    },
  );
});

test("出勤時刻は既存区間の開始を重複、終了を非重複とする", () => {
  const existing = attendance("existing", date("23:49"), date("23:59"));
  assert.deepEqual(
    findAttendanceClockInTimeOverlap(userId, date("23:49"), [existing]),
    {
      attendanceId: existing.attendanceId,
      userId: existing.userId,
      clockInAt: existing.clockInAt,
      clockOutAt: existing.clockOutAt,
    },
  );
  assert.equal(
    findAttendanceClockInTimeOverlap(userId, date("23:59"), [existing]),
    null,
  );
  assert.equal(
    findAttendanceClockInTimeOverlap(userId, date("23:48"), [existing]),
    null,
  );
});

test("部分重複、完全包含、逆包含、同一区間を検出する", () => {
  const cases = [
    ["09:00", "10:00", "09:30", "11:00"],
    ["09:00", "12:00", "10:00", "11:00"],
    ["10:00", "11:00", "09:00", "12:00"],
    ["09:00", "10:00", "09:00", "10:00"],
  ] as const;
  for (const [leftIn, leftOut, rightIn, rightOut] of cases) {
    const existing = attendance("b", date(rightIn), date(rightOut));
    assert.deepEqual(
      findAttendanceTimeOverlap(attendance("a", date(leftIn), date(leftOut)), [
        existing,
      ]),
      {
        attendanceId: existing.attendanceId,
        userId: existing.userId,
        clockInAt: existing.clockInAt,
        clockOutAt: existing.clockOutAt,
      },
    );
  }
});

test("日跨ぎ・workPeriod違いでも実時刻で重複を検出する", () => {
  const candidate = attendance(
    "candidate",
    new Date("2026-08-22T23:00:00.000Z"),
    new Date("2026-08-23T02:00:00.000Z"),
    { workPeriod: "night" },
  );
  const existing = attendance(
    "existing",
    new Date("2026-08-23T01:00:00.000Z"),
    new Date("2026-08-23T03:00:00.000Z"),
    { workPeriod: "day" },
  );
  assert.deepEqual(findAttendanceTimeOverlap(candidate, [existing]), {
    attendanceId: existing.attendanceId,
    userId: existing.userId,
    clockInAt: existing.clockInAt,
    clockOutAt: existing.clockOutAt,
  });
});

test("対象自身、cancelled、別ユーザーは除外する", () => {
  const candidate = attendance("candidate", date("09:00"), date("10:00"));
  const existing = [
    attendance("candidate", date("09:00"), date("10:00")),
    attendance("cancelled", date("09:15"), date("09:45"), {
      isCancelled: true,
    }),
    attendance("other-user", date("09:15"), date("09:45"), {
      userId: "user-2",
    }),
  ];
  assert.equal(findAttendanceTimeOverlap(candidate, existing), null);
});

test("出勤時刻の判定でも取消済み、別ユーザー、勤務中は除外する", () => {
  const existing = [
    attendance("cancelled", date("23:49"), date("23:59"), {
      isCancelled: true,
    }),
    attendance("other-user", date("23:49"), date("23:59"), {
      userId: "user-2",
    }),
    attendance("working", date("23:49"), null),
  ];
  assert.equal(
    findAttendanceClockInTimeOverlap(userId, date("23:50"), existing),
    null,
  );
});

test("退勤がない勤務中区間は重複判定対象にしない", () => {
  const existing = attendance("existing", date("09:00"), date("10:00"));
  assert.equal(
    findAttendanceTimeOverlap(attendance("missing-in", null, date("10:00")), [
      existing,
    ]),
    null,
  );
  assert.equal(
    findAttendanceTimeOverlap(attendance("working", date("09:00"), null), [
      existing,
    ]),
    null,
  );
});

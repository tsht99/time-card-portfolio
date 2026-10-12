import assert from "node:assert/strict";
import test from "node:test";
import type {
  AttendanceDomainEvent,
  WorkPeriod,
} from "../domain/attendance.ts";
import { attendanceEventTypeEnum, workPeriodEnum } from "./enums.ts";

type EnumValue<Enum extends { enumValues: readonly string[] }> =
  Enum["enumValues"][number];
type Exact<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type Assert<T extends true> = T;

export type AttendanceDbEnumAlignment = [
  Assert<Exact<EnumValue<typeof workPeriodEnum>, WorkPeriod>>,
  Assert<
    Exact<
      EnumValue<typeof attendanceEventTypeEnum>,
      AttendanceDomainEvent["eventType"]
    >
  >,
];

test("attendance schema enums match attendance domain values", () => {
  assert.deepEqual(workPeriodEnum.enumValues, ["day", "night"]);
  assert.deepEqual(attendanceEventTypeEnum.enumValues, [
    "AttendanceClockedIn",
    "AttendanceClockedOut",
    "WorkPeriodCorrected",
    "ClockInTimeCorrected",
    "ClockOutTimeCorrected",
    "AttendanceCancelled",
  ]);
});

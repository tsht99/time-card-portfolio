import { pgEnum } from "drizzle-orm/pg-core";

export const workPeriodEnum = pgEnum("work_period", ["day", "night"]);

export const attendanceEventTypeEnum = pgEnum("attendance_event_type", [
  "AttendanceClockedIn",
  "AttendanceClockedOut",
  "WorkPeriodCorrected",
  "ClockInTimeCorrected",
  "ClockOutTimeCorrected",
  "AttendanceCancelled",
]);

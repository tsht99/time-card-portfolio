import { users } from "@repo/users/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workPeriodEnum } from "./enums.ts";

/**
 * A query-oriented copy of the latest state for each attendance stream.
 *
 * Attendance events remain the source of truth; this table intentionally
 * contains no event payload or event history.
 */
export const attendanceCurrentStates = pgTable(
  "attendance_current_states",
  {
    attendanceId: uuid("attendance_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    attendanceDate: date("attendance_date").notNull(),
    workPeriod: workPeriodEnum("work_period").notNull(),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    eventVersion: integer("event_version").notNull(),
    isCancelled: boolean("is_cancelled").notNull().default(false),
  },
  (table) => [
    index("attendance_current_states_attendance_date_idx").on(
      table.attendanceDate,
    ),
    index("attendance_current_states_user_id_attendance_date_idx").on(
      table.userId,
      table.attendanceDate,
    ),
    uniqueIndex("attendance_current_states_one_working_per_user_idx")
      .on(table.userId)
      .where(sql`${table.clockOutAt} is null and ${table.isCancelled} = false`),
  ],
);

/**
 * Read-model readiness is explicit so consumers can safely choose a replay
 * fallback only while the projection has not been initialized.
 */
export const attendanceCurrentStateProjectionMetadata = pgTable(
  "attendance_current_state_projection_metadata",
  {
    projectionName: text("projection_name").primaryKey(),
    isReady: boolean("is_ready").notNull().default(false),
  },
);

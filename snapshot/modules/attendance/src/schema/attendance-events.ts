import { users } from "@repo/users/schema";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { attendanceEventTypeEnum } from "./enums.ts";

export const attendanceEvents = pgTable(
  "attendance_events",
  {
    eventId: uuid("event_id").defaultRandom().primaryKey(),
    attendanceId: uuid("attendance_id").notNull(),
    performedByUserId: uuid("performed_by_user_id")
      .notNull()
      .references(() => users.id),
    eventVersion: integer("event_version").notNull(),
    eventType: attendanceEventTypeEnum("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "attendance_events_event_version_positive_check",
      sql`${table.eventVersion} > 0`,
    ),
    check(
      "attendance_events_payload_object_check",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    unique("attendance_events_attendance_id_event_version_unique").on(
      table.attendanceId,
      table.eventVersion,
    ),
    index("attendance_events_clocked_in_user_id_idx")
      .using("btree", sql`(${table.payload}->>'userId')`, table.attendanceId)
      .where(
        sql`${table.eventType} = 'AttendanceClockedIn'::attendance_event_type`,
      ),
  ],
);

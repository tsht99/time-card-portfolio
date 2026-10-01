import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userRoleEnum, userStatusEnum } from "./enums.ts";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lineUserId: text("line_user_id").notNull().unique(),
    displayName: text("display_name"),
    role: userRoleEnum("role").notNull().default("staff"),
    status: userStatusEnum("status").notNull().default("pending"),
  },
  (table) => [
    check(
      "users_display_name_length_check",
      sql`${table.displayName} is null or char_length(${table.displayName}) between 1 and 100`,
    ),
    check(
      "users_staff_active_inactive_display_name_required_check",
      sql`${table.role} <> 'staff'::user_role or ${table.status} = 'pending'::user_status or ${table.displayName} is not null`,
    ),
    uniqueIndex("users_active_inactive_display_name_unique")
      .on(table.displayName)
      .where(
        sql`${table.status} in ('active'::user_status, 'inactive'::user_status) and ${table.displayName} is not null`,
      ),
  ],
);

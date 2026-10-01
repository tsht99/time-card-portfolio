import { workPeriodEnum } from "@repo/attendance/schema";
import { users } from "@repo/users/schema";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { hourlyWageDayTypeEnum } from "./enums.ts";

export const hourlyWageRates = pgTable(
  "hourly_wage_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    workPeriod: workPeriodEnum("work_period").notNull(),
    dayType: hourlyWageDayTypeEnum("day_type").notNull(),
    hourlyWage: integer("hourly_wage").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("hourly_wage_rates_user_period_day_effective_unique").on(
      table.userId,
      table.workPeriod,
      table.dayType,
      table.effectiveFrom,
    ),
    check(
      "hourly_wage_rates_hourly_wage_range_check",
      sql`${table.hourlyWage} >= 0 and ${table.hourlyWage} <= 99999`,
    ),
    check(
      "hourly_wage_rates_version_positive_check",
      sql`${table.version} >= 1`,
    ),
  ],
);

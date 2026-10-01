import { pgEnum } from "drizzle-orm/pg-core";

export const hourlyWageDayTypeEnum = pgEnum("hourly_wage_day_type", [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "holiday",
]);

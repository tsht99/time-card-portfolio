import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["staff", "admin"]);

export const userStatusEnum = pgEnum("user_status", [
  "pending",
  "active",
  "inactive",
]);

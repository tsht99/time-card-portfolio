import { startMediumTestDatabase as startDatabase } from "@repo/test-support/medium-postgres";
import { users } from "@repo/users/schema";
import { PostgresAttendanceEventStore } from "../infrastructure/postgres-attendance-event-store.ts";
import * as attendanceSchema from "../schema/index.ts";

export { users };

const schema = { ...attendanceSchema, users };

export function startMediumTestDatabase() {
  return startDatabase({ schema });
}

export function createPostgresAttendanceEventStore(
  database: Awaited<ReturnType<typeof startMediumTestDatabase>>,
) {
  return new PostgresAttendanceEventStore(database.db);
}

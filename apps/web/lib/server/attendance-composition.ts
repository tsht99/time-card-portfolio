import "server-only";

import { createAttendanceApplication as createAttendanceUseCases } from "@repo/attendance";
import {
  PostgresAttendanceCurrentStateReadModel,
  PostgresAttendanceEventStore,
} from "@repo/attendance/infrastructure";
import { getDatabase } from "@repo/db";
import { createTimeCardUserReadApplication } from "./users-access";

export function createAttendanceApplication(
  options: { now?: () => Date } = {},
) {
  const db = getDatabase();
  const useCases = createAttendanceUseCases({
    eventStore: new PostgresAttendanceEventStore(db),
    currentStateReadModel: new PostgresAttendanceCurrentStateReadModel(db),
    userReferences: createTimeCardUserReadApplication(),
    ...(options.now ? { now: options.now } : {}),
  });
  return useCases;
}

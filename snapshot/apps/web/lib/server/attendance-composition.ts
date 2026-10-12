import "server-only";

import type {
  AttendanceTransactionUnitOfWork,
  AttendanceUserReferenceReader,
} from "@repo/attendance";
import { createAttendanceApplication } from "@repo/attendance";
import { PostgresAttendanceCurrentStateReadModel } from "@repo/attendance/infrastructure";
import { PostgresAttendanceEventStore } from "@repo/attendance/internal";
import { getDatabase } from "@repo/db";
import type { PostgresDatabase } from "@repo/postgres";
import { users } from "@repo/users/schema";
import { eq } from "drizzle-orm";
import { createTimeCardUserReadApplication } from "./users-composition";

/** Runs attendance event-store work with transaction-bound readers. */
export class PostgresAttendanceEventStoreUnitOfWork
  implements AttendanceTransactionUnitOfWork
{
  constructor(private readonly db: PostgresDatabase) {}

  async runInTransaction<T>(
    operation: (context: {
      users: AttendanceUserReferenceReader;
      eventStore: PostgresAttendanceEventStore;
    }) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const references: AttendanceUserReferenceReader = {
        async getUsers() {
          return tx
            .select({
              userId: users.id,
              displayName: users.displayName,
              role: users.role,
              status: users.status,
            })
            .from(users);
        },
        async getUserById(userId) {
          const [row] = await tx
            .select({
              userId: users.id,
              role: users.role,
              status: users.status,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          return row ?? null;
        },
      };
      return operation({
        users: references,
        eventStore: new PostgresAttendanceEventStore(tx, true),
      });
    });
  }
}

export function createTimeCardAttendanceApplication(
  options: { now?: () => Date } = {},
) {
  const db = getDatabase();
  const useCases = createAttendanceApplication({
    eventStore: new PostgresAttendanceEventStore(db),
    currentStateReadModel: new PostgresAttendanceCurrentStateReadModel(db),
    userReferences: createTimeCardUserReadApplication(),
    transactionUnitOfWork: new PostgresAttendanceEventStoreUnitOfWork(db),
    ...(options.now ? { now: options.now } : {}),
  });
  return useCases;
}

/** User fields Attendance needs when authorizing or displaying attendance. */
export type AttendanceUserReferenceReader = {
  getUsers: () => Promise<
    Array<{
      userId: string;
      displayName: string | null;
      role: string;
      status: string;
    }>
  >;
  getUserById: (userId: string) => Promise<{
    userId: string;
    role: string;
    status: string;
  } | null>;
};

export type AttendanceTransactionUnitOfWork = {
  /** Runs event-store work in a transaction with transaction-bound readers. */
  runInTransaction<T>(
    operation: (context: {
      users: AttendanceUserReferenceReader;
      eventStore: AttendanceEventStore;
    }) => Promise<T>,
  ): Promise<T>;
};

import type { AttendanceEventStore } from "./attendance-event-store.ts";

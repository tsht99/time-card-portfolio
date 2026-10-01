import { createHash } from "node:crypto";
import type { PostgresDatabase } from "@repo/platform";
import { asc, eq, inArray, max, sql } from "drizzle-orm";
import { aggregateToCurrentState } from "../application/attendance-current-state.ts";
import type {
  AttendanceEventAppendOptions,
  AttendanceEventStore,
  AttendanceLock,
  StoredAttendanceEvent,
} from "../application/attendance-event-store.ts";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
} from "../domain/attendance.ts";
import { attendanceEvents } from "../schema/attendance-events.ts";
import { deserializeAttendanceEvent } from "./attendance-event-deserializer.ts";
import { validateAttendanceEventAppend } from "./attendance-event-store.ts";
import { PostgresAttendanceCurrentStateReadModel } from "./postgres-attendance-current-state-read-model.ts";

const toDomainEvent = deserializeAttendanceEvent;

export class PostgresAttendanceEventStore implements AttendanceEventStore {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly inTransaction = false,
    private readonly heldLockRanks: readonly number[] = [],
  ) {}

  async runExclusive<T>(
    lock: AttendanceLock,
    operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T> {
    assertLockNestingOrder(this.heldLockRanks, lock);
    if (this.inTransaction) {
      await acquireAdvisoryLock(this.db, lock);
      return operation(
        new PostgresAttendanceEventStore(this.db, true, [
          ...this.heldLockRanks,
          attendanceLockRank(lock),
        ]),
      );
    }
    return this.db.transaction(async (tx) => {
      await acquireAdvisoryLock(tx, lock);
      return operation(
        new PostgresAttendanceEventStore(tx, true, [attendanceLockRank(lock)]),
      );
    });
  }

  async readAll(): Promise<readonly StoredAttendanceEvent[]> {
    const rows = await this.db
      .select()
      .from(attendanceEvents)
      .orderBy(
        asc(attendanceEvents.attendanceId),
        asc(attendanceEvents.eventVersion),
      );
    return rows.map(toDomainEvent);
  }

  async readStream(
    attendanceId: string,
  ): Promise<readonly StoredAttendanceEvent[]> {
    const rows = await this.db
      .select()
      .from(attendanceEvents)
      .where(eq(attendanceEvents.attendanceId, attendanceId))
      .orderBy(asc(attendanceEvents.eventVersion));
    return rows.map(toDomainEvent);
  }

  async readStreamsByUserId(
    userId: string,
  ): Promise<readonly StoredAttendanceEvent[]> {
    const attendanceIds = this.db
      .select({ attendanceId: attendanceEvents.attendanceId })
      .from(attendanceEvents)
      .where(
        sql`${attendanceEvents.eventType} = 'AttendanceClockedIn' AND ${attendanceEvents.payload}->>'userId' = ${userId}`,
      );
    const rows = await this.db
      .select()
      .from(attendanceEvents)
      .where(inArray(attendanceEvents.attendanceId, attendanceIds))
      .orderBy(
        asc(attendanceEvents.attendanceId),
        asc(attendanceEvents.eventVersion),
      );
    return rows.map(toDomainEvent);
  }

  async append(
    events: readonly AttendanceDomainEvent[],
    options: AttendanceEventAppendOptions,
  ): Promise<void> {
    if (events.length === 0) return;
    if (!this.inTransaction) {
      await this.runExclusive(
        { type: "stream", attendanceId: events[0].attendanceId },
        async (store) => store.append(events, options),
      );
      return;
    }
    assertLockNestingOrder(this.heldLockRanks, {
      type: "stream",
      attendanceId: events[0].attendanceId,
    });
    await acquireAdvisoryLock(this.db, {
      type: "stream",
      attendanceId: events[0].attendanceId,
    });
    await this.appendInTransaction(events, options);
  }

  private async appendInTransaction(
    events: readonly AttendanceDomainEvent[],
    options: AttendanceEventAppendOptions,
  ): Promise<void> {
    const streamAttendanceId = events[0].attendanceId;
    const [{ currentVersion }] = await this.db
      .select({ currentVersion: max(attendanceEvents.eventVersion) })
      .from(attendanceEvents)
      .where(eq(attendanceEvents.attendanceId, streamAttendanceId));
    const actualVersion = currentVersion ?? 0;
    validateAttendanceEventAppend(events, options, actualVersion);
    await this.db.insert(attendanceEvents).values(
      events.map((event) => ({
        attendanceId: event.attendanceId,
        performedByUserId: options.performedByUserId,
        eventVersion: event.eventVersion,
        eventType: event.eventType,
        payload: Object.fromEntries(
          Object.entries(event.payload).map(([key, value]) => [
            key,
            value instanceof Date ? value.toISOString() : value,
          ]),
        ),
      })),
    );

    const aggregate = AttendanceAggregate.replay(
      await this.readStream(streamAttendanceId),
    );
    const currentStateReadModel = new PostgresAttendanceCurrentStateReadModel(
      this.db,
    );
    await currentStateReadModel.upsert(aggregateToCurrentState(aggregate));
  }
}

function attendanceLockRank(lock: AttendanceLock): number {
  switch (lock.type) {
    case "user":
      return 0;
    case "stream":
      return 1;
  }
}

function assertLockNestingOrder(
  heldLockRanks: readonly number[],
  lock: AttendanceLock,
): void {
  const rank = attendanceLockRank(lock);
  if (heldLockRanks.some((heldRank) => rank < heldRank)) {
    throw new Error("Attendance locks must be nested in user, stream order.");
  }
}

async function acquireAdvisoryLock(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  lock: AttendanceLock,
) {
  // Nested lock order is user -> stream. Callers that need more than one lock
  // must acquire them in this order.
  const value =
    lock.type === "user"
      ? `user\0${lock.userId}`
      : `stream\0${lock.attendanceId}`;
  const digest = createHash("sha256").update(value).digest();
  const key1 = digest.readInt32BE(0);
  const key2 = digest.readInt32BE(4);
  await tx.execute(sql`select pg_advisory_xact_lock(${key1}, ${key2})`);
}

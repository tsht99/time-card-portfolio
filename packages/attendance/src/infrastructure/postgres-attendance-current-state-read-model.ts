import type { PostgresDatabase } from "@repo/platform";
import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  type SQL,
} from "drizzle-orm";
import type { AttendanceCurrentState } from "../application/attendance-current-state.ts";
import type {
  AttendanceCurrentStateQuery,
  AttendanceCurrentStateQueryResult,
  AttendanceCurrentStateReadModel,
} from "../application/attendance-current-state-read-model.ts";
import {
  attendanceCurrentStateProjectionMetadata,
  attendanceCurrentStates,
} from "../schema/attendance-current-states.ts";
import { attendanceCurrentStateProjectionName } from "./attendance-current-state-projection.ts";

function toAttendanceCurrentState(
  row: typeof attendanceCurrentStates.$inferSelect,
): AttendanceCurrentState {
  if (!Number.isInteger(row.eventVersion) || row.eventVersion < 0) {
    throw new Error(
      `Invalid attendance current-state event version: ${row.eventVersion}`,
    );
  }
  return {
    attendanceId: row.attendanceId,
    userId: row.userId,
    attendanceDate: row.attendanceDate,
    workPeriod: row.workPeriod,
    clockInAt: row.clockInAt,
    clockOutAt: row.clockOutAt,
    eventVersion: row.eventVersion,
    isCancelled: row.isCancelled,
  };
}

function statusCondition(
  status: AttendanceCurrentStateQuery["status"],
): SQL | undefined {
  switch (status) {
    case "working":
      return isNull(attendanceCurrentStates.clockOutAt);
    case "completed":
      return isNotNull(attendanceCurrentStates.clockOutAt);
    case undefined:
      return undefined;
  }
}

export class PostgresAttendanceCurrentStateReadModel
  implements AttendanceCurrentStateReadModel
{
  constructor(private readonly db: PostgresDatabase) {}

  async upsert(state: AttendanceCurrentState): Promise<void> {
    await this.db
      .insert(attendanceCurrentStates)
      .values(state)
      .onConflictDoUpdate({
        target: attendanceCurrentStates.attendanceId,
        set: {
          userId: state.userId,
          attendanceDate: state.attendanceDate,
          workPeriod: state.workPeriod,
          clockInAt: state.clockInAt,
          clockOutAt: state.clockOutAt,
          eventVersion: state.eventVersion,
          isCancelled: state.isCancelled,
        },
      });
  }

  async query(
    query: AttendanceCurrentStateQuery,
  ): Promise<AttendanceCurrentStateQueryResult> {
    const [metadata] = await this.db
      .select({ isReady: attendanceCurrentStateProjectionMetadata.isReady })
      .from(attendanceCurrentStateProjectionMetadata)
      .where(
        eq(
          attendanceCurrentStateProjectionMetadata.projectionName,
          attendanceCurrentStateProjectionName,
        ),
      )
      .limit(1);
    if (!metadata?.isReady) return { kind: "not-ready" };

    const conditions: SQL[] = [];
    if (query.startAttendanceDateInclusive) {
      const condition = gte(
        attendanceCurrentStates.attendanceDate,
        query.startAttendanceDateInclusive,
      );
      conditions.push(condition);
    }
    if (query.endAttendanceDateInclusive) {
      const condition = lte(
        attendanceCurrentStates.attendanceDate,
        query.endAttendanceDateInclusive,
      );
      conditions.push(condition);
    }
    if (query.userId) {
      conditions.push(eq(attendanceCurrentStates.userId, query.userId));
    }
    if (query.workPeriod) {
      conditions.push(eq(attendanceCurrentStates.workPeriod, query.workPeriod));
    }
    conditions.push(
      eq(attendanceCurrentStates.isCancelled, query.includeCancelled === true),
    );
    const byStatus = statusCondition(query.status);
    if (byStatus) conditions.push(byStatus);

    const rows = await this.db
      .select()
      .from(attendanceCurrentStates)
      .where(and(...conditions))
      .orderBy(
        asc(attendanceCurrentStates.attendanceDate),
        asc(attendanceCurrentStates.userId),
        asc(attendanceCurrentStates.workPeriod),
        asc(attendanceCurrentStates.attendanceId),
      );
    return { kind: "ready", states: rows.map(toAttendanceCurrentState) };
  }
}

import type { PostgresDatabase } from "@repo/platform";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { replayAttendanceCurrentStatesFromEvents } from "../../application/attendance-replay.ts";
import {
  attendanceCurrentStateProjectionMetadata,
  attendanceCurrentStates,
} from "../../schema/attendance-current-states.ts";
import * as schema from "../../schema/index.ts";
import { attendanceCurrentStateProjectionName } from "../attendance-current-state-projection.ts";
import { AttendanceEventStoreCorruptionError } from "../attendance-event-deserializer.ts";
import type { StoredAttendanceEvent } from "../attendance-event-store.ts";
import { PostgresAttendanceEventStore } from "../postgres-attendance-event-store.ts";
import {
  AttendanceCurrentStateProjectionRebuildError,
  createAttendanceCurrentStateProjectionRebuildError,
} from "./attendance-current-state-projection-rebuild-error.ts";

const rebuildAdvisoryLockKey1 = 1_701_906_204;
const rebuildAdvisoryLockKey2 = -1_989_047_455;

export type AttendanceCurrentStateProjectionRebuildResult = {
  currentStateCount: number;
};

async function setProjectionReadiness(
  db: PostgresDatabase,
  isReady: boolean,
): Promise<void> {
  await db
    .insert(attendanceCurrentStateProjectionMetadata)
    .values({
      projectionName: attendanceCurrentStateProjectionName,
      isReady,
    })
    .onConflictDoUpdate({
      target: attendanceCurrentStateProjectionMetadata.projectionName,
      set: { isReady },
    });
}

/**
 * Rebuilds the entire attendance current-state projection from the Event Store.
 *
 * The caller owns the PoolClient lifetime. A session-level advisory lock is
 * deliberately held on that fixed client across both transactions.
 */
export class PostgresAttendanceCurrentStateProjectionRebuilder {
  constructor(private readonly client: PoolClient) {}

  async rebuild(): Promise<AttendanceCurrentStateProjectionRebuildResult> {
    const db = drizzle(this.client, { schema }) satisfies PostgresDatabase;
    let advisoryLockAcquired = false;
    let rebuildFailed = false;
    let rebuildFailure: unknown;
    let rebuildResult:
      | AttendanceCurrentStateProjectionRebuildResult
      | undefined;
    let releaseFailure: unknown;

    try {
      // This key is intentionally unrelated to the migration and per-stream
      // advisory locks. It serializes complete rebuild lifecycles.
      try {
        await this.client.query("SELECT pg_advisory_lock($1, $2)", [
          rebuildAdvisoryLockKey1,
          rebuildAdvisoryLockKey2,
        ]);
      } catch (error) {
        throw createAttendanceCurrentStateProjectionRebuildError(
          "acquire_rebuild_lock",
          error,
        );
      }
      advisoryLockAcquired = true;

      try {
        await db.transaction((tx) => setProjectionReadiness(tx, false));
      } catch (error) {
        throw createAttendanceCurrentStateProjectionRebuildError(
          "mark_projection_not_ready",
          error,
        );
      }

      try {
        rebuildResult = await db.transaction(async (tx) => {
          // INSERT used by normal append takes ROW EXCLUSIVE, which conflicts
          // with SHARE. Keep it until the replacement commits.
          try {
            await tx.execute(
              sql.raw("LOCK TABLE attendance_events IN SHARE MODE"),
            );
          } catch (error) {
            throw createAttendanceCurrentStateProjectionRebuildError(
              "lock_event_store",
              error,
            );
          }

          const eventStore = new PostgresAttendanceEventStore(tx);
          let events: readonly StoredAttendanceEvent[];
          try {
            events = await eventStore.readAll();
          } catch (error) {
            if (error instanceof AttendanceEventStoreCorruptionError) {
              throw createAttendanceCurrentStateProjectionRebuildError(
                "deserialize_event",
                error,
                error.attendanceId,
              );
            }
            throw createAttendanceCurrentStateProjectionRebuildError(
              "read_event_store",
              error,
            );
          }

          const states = replayAttendanceCurrentStatesFromEvents(
            events,
            (attendanceId, sourceError) => {
              throw createAttendanceCurrentStateProjectionRebuildError(
                "replay_event_stream",
                sourceError,
                attendanceId,
              );
            },
            { includeCancelled: true },
          );

          try {
            await tx.delete(attendanceCurrentStates);
            if (states.length > 0) {
              await tx.insert(attendanceCurrentStates).values(states);
            }
          } catch (error) {
            throw createAttendanceCurrentStateProjectionRebuildError(
              "replace_projection",
              error,
            );
          }

          try {
            await setProjectionReadiness(tx, true);
          } catch (error) {
            throw createAttendanceCurrentStateProjectionRebuildError(
              "mark_projection_ready",
              error,
            );
          }

          return { currentStateCount: states.length };
        });
      } catch (error) {
        throw createAttendanceCurrentStateProjectionRebuildError(
          "replace_projection_transaction",
          error,
        );
      }
    } catch (error) {
      rebuildFailed = true;
      rebuildFailure = error;
    } finally {
      if (advisoryLockAcquired) {
        try {
          await this.client.query("SELECT pg_advisory_unlock($1, $2)", [
            rebuildAdvisoryLockKey1,
            rebuildAdvisoryLockKey2,
          ]);
        } catch (error) {
          releaseFailure = error;
        }
      }
    }

    const releaseError =
      releaseFailure === undefined
        ? undefined
        : createAttendanceCurrentStateProjectionRebuildError(
            "release_rebuild_lock",
            releaseFailure,
          );
    if (rebuildFailed) {
      if (
        releaseError !== undefined &&
        !(
          rebuildFailure instanceof AttendanceCurrentStateProjectionRebuildError
        )
      )
        throw releaseError;
      throw rebuildFailure;
    }
    if (releaseError !== undefined) throw releaseError;
    return rebuildResult as AttendanceCurrentStateProjectionRebuildResult;
  }
}

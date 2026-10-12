import { randomUUID } from "node:crypto";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
  InvalidAttendanceTransitionError,
  type WorkPeriod,
} from "../domain/attendance.ts";
import { deriveAttendanceDateFromClockInAt } from "../domain/attendance-date.ts";
import { AttendanceTimeOverlapError } from "../domain/attendance-overlap.ts";
import { validateAttendanceAgainstUserHistory } from "./attendance-current-state-validation.ts";
import {
  type AttendanceEventStore,
  AttendanceEventVersionConflictError,
} from "./ports/attendance-event-store.ts";

export type AttendanceManualCreationCommand = {
  userId: string;
  performedByUserId: string;
  workPeriod: WorkPeriod;
  clockInAt: Date;
  clockOutAt: Date;
};

export type AttendanceManualCreationResult = {
  attendanceId: string;
  events: readonly AttendanceDomainEvent[];
};

export class AttendanceManualCreationCommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceManualCreationCommandRejectedError";
  }
}

export type AttendanceManualCreationServiceOptions = {
  createAttendanceId?: () => string;
};

/** Creates a complete attendance stream in one atomic append. */
export class AttendanceManualCreationService {
  private readonly createAttendanceId: () => string;

  constructor(
    private readonly eventStore: AttendanceEventStore,
    options: AttendanceManualCreationServiceOptions = {},
  ) {
    this.createAttendanceId = options.createAttendanceId ?? randomUUID;
  }

  async execute(
    command: AttendanceManualCreationCommand,
  ): Promise<AttendanceManualCreationResult> {
    return this.eventStore.runExclusive(
      { type: "user", userId: command.userId },
      async (store) => {
        const attendanceId = this.createAttendanceId();
        const aggregate = AttendanceAggregate.start(attendanceId);
        const attendanceDate = deriveAttendanceDateFromClockInAt(
          command.clockInAt,
        );
        let events: readonly AttendanceDomainEvent[];
        try {
          events = [
            aggregate.clockIn({
              userId: command.userId,
              workPeriod: command.workPeriod,
              attendanceDate,
              clockInAt: command.clockInAt,
            }),
            aggregate.clockOut({ clockOutAt: command.clockOutAt }),
          ];
        } catch (error) {
          if (error instanceof InvalidAttendanceTransitionError) {
            throw new AttendanceManualCreationCommandRejectedError(
              error.message,
            );
          }
          throw error;
        }

        const conflicts = await validateAttendanceAgainstUserHistory(
          store,
          aggregate,
        );
        if (conflicts.hasOverlap) {
          throw new AttendanceTimeOverlapError();
        }

        try {
          await store.append(events, {
            expectedVersion: 0,
            performedByUserId: command.performedByUserId,
          });
        } catch (error) {
          if (error instanceof AttendanceEventVersionConflictError) {
            throw new AttendanceManualCreationCommandRejectedError(
              error.message,
            );
          }
          throw error;
        }
        return { attendanceId, events };
      },
    );
  }
}

export function createAttendanceManualCreationService(
  eventStore: AttendanceEventStore,
  options?: AttendanceManualCreationServiceOptions,
): AttendanceManualCreationService {
  return new AttendanceManualCreationService(eventStore, options);
}

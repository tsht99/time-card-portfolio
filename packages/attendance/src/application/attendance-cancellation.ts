import {
  canManageAttendance,
  type UserRole,
  type UserStatus,
} from "@repo/users";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
  InvalidAttendanceTransitionError,
} from "../domain/attendance.ts";

import {
  type AttendanceEventStore,
  AttendanceEventVersionConflictError,
} from "./attendance-event-store.ts";

export type AttendanceCancellationCommand = {
  attendanceId: string;
  expectedVersion: number;
  actor: {
    userId: string;
    role: UserRole;
    status: UserStatus;
  };
};

export class AttendanceCancellationCommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceCancellationCommandRejectedError";
  }
}

export class AttendanceCancellationForbiddenError extends Error {
  constructor(message = "You are not allowed to cancel this attendance.") {
    super(message);
    this.name = "AttendanceCancellationForbiddenError";
  }
}

export class AttendanceCancellationVersionConflictError extends Error {
  constructor(message = "Attendance was updated by another operation.") {
    super(message);
    this.name = "AttendanceCancellationVersionConflictError";
  }
}

/** Executes cancellation commands against an existing attendance event stream. */
export class AttendanceCancellationService {
  constructor(private readonly eventStore: AttendanceEventStore) {}

  async execute(
    command: AttendanceCancellationCommand,
  ): Promise<AttendanceDomainEvent> {
    if (!canManageAttendance(command.actor.role, command.actor.status)) {
      throw new AttendanceCancellationForbiddenError();
    }

    return this.eventStore.runExclusive(
      { type: "stream", attendanceId: command.attendanceId },
      async (store) => {
        const events = await store.readStream(command.attendanceId);
        if (events.length === 0) {
          throw new AttendanceCancellationCommandRejectedError(
            "Attendance event stream was not found.",
          );
        }

        const aggregate = AttendanceAggregate.replay(events);
        if (aggregate.version !== command.expectedVersion) {
          throw new AttendanceCancellationVersionConflictError();
        }
        if (aggregate.userId === null || aggregate.clockInAt === null) {
          throw new AttendanceCancellationForbiddenError();
        }
        try {
          const event = aggregate.cancel();
          await store.append([event], {
            expectedVersion: command.expectedVersion,
            performedByUserId: command.actor.userId,
          });
          return event;
        } catch (error) {
          if (error instanceof AttendanceEventVersionConflictError) {
            throw new AttendanceCancellationVersionConflictError(error.message);
          }
          if (error instanceof InvalidAttendanceTransitionError) {
            throw new AttendanceCancellationCommandRejectedError(error.message);
          }
          throw error;
        }
      },
    );
  }
}

export function createAttendanceCancellationService(
  eventStore: AttendanceEventStore,
): AttendanceCancellationService {
  return new AttendanceCancellationService(eventStore);
}

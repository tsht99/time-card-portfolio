import {
  canManageAttendance,
  type UserRole,
  type UserStatus,
} from "@repo/users";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
  InvalidAttendanceTransitionError,
  type WorkPeriod,
} from "../domain/attendance.ts";
import {
  AttendanceTimeOverlapError,
  findAttendanceTimeOverlap,
} from "../domain/attendance-overlap.ts";
import {
  type AttendanceEventStore,
  AttendanceEventVersionConflictError,
} from "./attendance-event-store.ts";
import { replayAttendanceEventStreams } from "./attendance-replay.ts";

export type AttendanceCorrectionCommand = {
  attendanceId: string;
  expectedVersion: number;
  actor: {
    userId: string;
    role: UserRole;
    status: UserStatus;
  };
  changes: {
    workPeriod?: WorkPeriod;
    clockInAt?: Date;
    clockOutAt?: Date;
  };
};

export class AttendanceCorrectionCommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceCorrectionCommandRejectedError";
  }
}

export class AttendanceCorrectionForbiddenError extends Error {
  constructor(message = "You are not allowed to correct this attendance.") {
    super(message);
    this.name = "AttendanceCorrectionForbiddenError";
  }
}

export class AttendanceCorrectionVersionConflictError extends Error {
  constructor(message = "Attendance was updated by another operation.") {
    super(message);
    this.name = "AttendanceCorrectionVersionConflictError";
  }
}

/** Applies work-period and clock-time corrections to an existing attendance event stream. */
export class AttendanceCorrectionService {
  constructor(private readonly eventStore: AttendanceEventStore) {}

  async execute(
    command: AttendanceCorrectionCommand,
  ): Promise<readonly AttendanceDomainEvent[]> {
    if (!canManageAttendance(command.actor.role, command.actor.status)) {
      throw new AttendanceCorrectionForbiddenError();
    }
    // Read only enough state to determine the user lock. The stream is read
    // again after the lock because this first read may race with a clock.
    const initialEvents = await this.eventStore.readStream(
      command.attendanceId,
    );
    if (initialEvents.length === 0) {
      throw new AttendanceCorrectionCommandRejectedError(
        "Attendance event stream was not found.",
      );
    }
    const initialAggregate = AttendanceAggregate.replay(initialEvents);
    if (
      initialAggregate.userId === null ||
      initialAggregate.workPeriod === null ||
      initialAggregate.clockInAt === null
    ) {
      throw new AttendanceCorrectionCommandRejectedError(
        "Attendance has not been clocked in.",
      );
    }
    const userId = initialAggregate.userId;
    const runCorrection = (store: AttendanceEventStore) =>
      store.runExclusive(
        { type: "stream", attendanceId: command.attendanceId },
        async (lockedStore) => {
          const streamEvents = await lockedStore.readStream(
            command.attendanceId,
          );
          const aggregate = AttendanceAggregate.replay(streamEvents);
          if (command.expectedVersion !== aggregate.version) {
            throw new AttendanceCorrectionVersionConflictError();
          }
          if (
            aggregate.userId === null ||
            aggregate.workPeriod === null ||
            aggregate.clockInAt === null
          ) {
            throw new AttendanceCorrectionCommandRejectedError(
              "Attendance has not been clocked in.",
            );
          }

          const expectedVersion = aggregate.version;
          const correctionEvents = await this.applyCorrections(
            aggregate,
            command,
          );
          const after =
            correctionEvents.length > 0
              ? AttendanceAggregate.replay([
                  ...streamEvents,
                  ...correctionEvents,
                ])
              : aggregate;
          if (after.clockInAt !== null && after.clockOutAt !== null) {
            const active = replayAttendanceEventStreams(
              await lockedStore.readStreamsByUserId(aggregate.userId),
            ).map((attendance) => attendance.state);
            if (findAttendanceTimeOverlap(after.state, active))
              throw new AttendanceTimeOverlapError();
          }
          if (correctionEvents.length > 0) {
            try {
              await lockedStore.append(correctionEvents, {
                expectedVersion,
                performedByUserId: command.actor.userId,
              });
            } catch (error) {
              if (error instanceof AttendanceEventVersionConflictError)
                throw new AttendanceCorrectionVersionConflictError(
                  error.message,
                );
              throw error;
            }
          }
          return correctionEvents;
        },
      );

    const runWithUserLock = (store: AttendanceEventStore) =>
      store.runExclusive({ type: "user", userId }, runCorrection);
    return runWithUserLock(this.eventStore);
  }

  private async applyCorrections(
    aggregate: AttendanceAggregate,
    command: AttendanceCorrectionCommand,
  ): Promise<readonly AttendanceDomainEvent[]> {
    const correctionEvents: AttendanceDomainEvent[] = [];
    const { workPeriod, clockInAt, clockOutAt } = command.changes;
    const shouldCorrectWorkPeriod =
      workPeriod !== undefined && workPeriod !== aggregate.workPeriod;
    const shouldCorrectClockIn =
      clockInAt !== undefined && !sameTime(clockInAt, aggregate.clockInAt);
    const shouldCorrectClockOut =
      clockOutAt !== undefined && !sameTime(clockOutAt, aggregate.clockOutAt);

    try {
      const currentClockInAt = aggregate.clockInAt;
      if (currentClockInAt === null) {
        throw new InvalidAttendanceTransitionError(
          "Attendance has not been clocked in.",
        );
      }
      if (workPeriod !== undefined && shouldCorrectWorkPeriod)
        correctionEvents.push(aggregate.correctWorkPeriod({ workPeriod }));

      // Keep every intermediate aggregate valid. A working attendance must be
      // completed with AttendanceClockedOut; an already completed attendance
      // uses the correction event for an existing clock-out.
      const appendClockOut = () => {
        if (clockOutAt === undefined || !shouldCorrectClockOut) return;
        correctionEvents.push(aggregate.clockOut({ clockOutAt }));
      };
      const correctClockOut = () => {
        if (
          clockOutAt === undefined ||
          !shouldCorrectClockOut ||
          aggregate.clockOutAt === null
        )
          return;
        correctionEvents.push(aggregate.correctClockOutTime({ clockOutAt }));
      };

      if (aggregate.clockOutAt === null) {
        const newClockOutBeforeCurrentClockIn =
          clockInAt !== undefined &&
          clockOutAt !== undefined &&
          clockOutAt.getTime() < currentClockInAt.getTime();
        if (newClockOutBeforeCurrentClockIn) {
          if (shouldCorrectClockIn)
            correctionEvents.push(aggregate.correctClockInTime({ clockInAt }));
          appendClockOut();
        } else {
          appendClockOut();
          if (shouldCorrectClockIn)
            correctionEvents.push(aggregate.correctClockInTime({ clockInAt }));
        }
      } else {
        // If the new clock-in is after the current clock-out, move the
        // clock-out first so that every intermediate aggregate state remains
        // valid.
        const correctClockOutFirst =
          clockInAt !== undefined &&
          clockOutAt !== undefined &&
          shouldCorrectClockIn &&
          shouldCorrectClockOut &&
          clockInAt.getTime() > aggregate.clockOutAt.getTime();

        if (correctClockOutFirst) {
          correctClockOut();
          correctionEvents.push(aggregate.correctClockInTime({ clockInAt }));
        } else {
          if (clockInAt !== undefined && shouldCorrectClockIn)
            correctionEvents.push(aggregate.correctClockInTime({ clockInAt }));
          correctClockOut();
        }
      }
    } catch (error) {
      if (error instanceof InvalidAttendanceTransitionError) {
        throw new AttendanceCorrectionCommandRejectedError(error.message);
      }
      throw error;
    }

    return correctionEvents;
  }
}

export function createAttendanceCorrectionService(
  eventStore: AttendanceEventStore,
): AttendanceCorrectionService {
  return new AttendanceCorrectionService(eventStore);
}

function sameTime(left: Date | null, right: Date | null): boolean {
  return (
    (left === null && right === null) ||
    (left !== null && right !== null && left.getTime() === right.getTime())
  );
}

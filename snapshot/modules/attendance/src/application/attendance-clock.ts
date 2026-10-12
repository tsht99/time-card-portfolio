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

type ClockInCommand = {
  userId: string;
  performedByUserId: string;
  workPeriod: WorkPeriod;
  eventType: "clock_in";
  occurredAt: Date;
};
type ClockOutCommand = {
  userId: string;
  performedByUserId: string;
  workPeriod: WorkPeriod;
  eventType: "clock_out";
  occurredAt: Date;
  targetAttendanceId: string;
  targetEventVersion: number;
};
export type AttendanceClockCommand = ClockInCommand | ClockOutCommand;

export class AttendanceClockCommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceClockCommandRejectedError";
  }
}

export class AttendanceClockStaleError extends Error {
  constructor() {
    super(
      "Attendance state changed after confirmation; refresh and try again.",
    );
    this.name = "AttendanceClockStaleError";
  }
}

export class AttendanceClockAlreadyWorkingError extends AttendanceClockCommandRejectedError {
  constructor() {
    super("A working attendance already exists for this user.");
    this.name = "AttendanceClockAlreadyWorkingError";
  }
}

export type AttendanceClockServiceOptions = {
  createAttendanceId?: () => string;
};

/**
 * Executes normal clock-in and clock-out commands against attendance event
 * streams. User-wide validation uses the current-state projection when ready
 * and replays the user's streams only while that projection is unavailable.
 */
export class AttendanceClockService {
  private readonly createAttendanceId: () => string;

  constructor(
    private readonly eventStore: AttendanceEventStore,
    options: AttendanceClockServiceOptions = {},
  ) {
    this.createAttendanceId = options.createAttendanceId ?? randomUUID;
  }

  async execute(
    command: AttendanceClockCommand,
  ): Promise<AttendanceDomainEvent> {
    if (command.eventType === "clock_in") {
      return this.eventStore.runExclusive(
        { type: "user", userId: command.userId },
        (userStore) => this.executeLocked(userStore, command),
      );
    }

    return this.eventStore.runExclusive(
      { type: "user", userId: command.userId },
      (userStore) => this.executeTargetedClockOut(userStore, command),
    );
  }

  private async executeTargetedClockOut(
    store: AttendanceEventStore,
    command: ClockOutCommand,
  ): Promise<AttendanceDomainEvent> {
    const targetEvents = await store.readStream(command.targetAttendanceId);
    const target = targetEvents.length
      ? AttendanceAggregate.replay(targetEvents)
      : undefined;
    if (
      !target ||
      target.userId !== command.userId ||
      target.isCancelled ||
      target.workPeriod !== command.workPeriod ||
      target.clockOutAt !== null ||
      target.version !== command.targetEventVersion
    ) {
      throw new AttendanceClockStaleError();
    }

    return this.appendClockOut(store, target, command);
  }

  private async appendClockOut(
    store: AttendanceEventStore,
    target: AttendanceAggregate,
    command: ClockOutCommand,
  ): Promise<AttendanceDomainEvent> {
    let event: AttendanceDomainEvent;
    const expectedVersion = command.targetEventVersion;
    try {
      event = target.clockOut({ clockOutAt: command.occurredAt });
    } catch (error) {
      if (error instanceof InvalidAttendanceTransitionError) {
        throw new AttendanceClockCommandRejectedError(error.message);
      }
      throw error;
    }
    const conflicts = await validateAttendanceAgainstUserHistory(
      store,
      target,
      { excludeAttendanceId: target.attendanceId },
    );
    if (conflicts.hasWorkingAttendance) throw new AttendanceClockStaleError();
    if (conflicts.hasOverlap) throw new AttendanceTimeOverlapError();
    try {
      await store.append([event], {
        expectedVersion,
        performedByUserId: command.performedByUserId,
      });
    } catch (error) {
      if (error instanceof AttendanceEventVersionConflictError)
        throw new AttendanceClockStaleError();
      throw error;
    }
    return event;
  }

  private async executeLocked(
    store: AttendanceEventStore,
    command: ClockInCommand,
  ): Promise<AttendanceDomainEvent> {
    const attendanceDate = deriveAttendanceDateFromClockInAt(
      command.occurredAt,
    );
    const aggregate = AttendanceAggregate.start(this.createAttendanceId());
    const event = aggregate.clockIn({
      userId: command.userId,
      workPeriod: command.workPeriod,
      attendanceDate,
      clockInAt: command.occurredAt,
    });
    const conflicts = await validateAttendanceAgainstUserHistory(
      store,
      aggregate,
    );
    if (conflicts.hasWorkingAttendance)
      throw new AttendanceClockAlreadyWorkingError();
    if (conflicts.hasClockInTimeConflict)
      throw new AttendanceTimeOverlapError();
    await store.append([event], {
      expectedVersion: 0,
      performedByUserId: command.performedByUserId,
    });
    return event;
  }
}

export function createAttendanceClockService(
  eventStore: AttendanceEventStore,
  options?: AttendanceClockServiceOptions,
): AttendanceClockService {
  return new AttendanceClockService(eventStore, options);
}

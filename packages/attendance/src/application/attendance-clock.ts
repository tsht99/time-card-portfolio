import { randomUUID } from "node:crypto";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
  InvalidAttendanceTransitionError,
  type WorkPeriod,
} from "../domain/attendance.ts";
import { deriveAttendanceDateFromClockInAt } from "../domain/attendance-date.ts";
import {
  AttendanceTimeOverlapError,
  findAttendanceClockInTimeOverlap,
  findAttendanceTimeOverlap,
  toAttendanceTimeInterval,
} from "../domain/attendance-overlap.ts";
import {
  type AttendanceEventStore,
  AttendanceEventVersionConflictError,
} from "./attendance-event-store.ts";
import { replayAttendanceEventStreams } from "./attendance-replay.ts";

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
} & (
  | {
      targetAttendanceId: string;
      targetEventVersion: number;
    }
  | {
      targetAttendanceId?: never;
      targetEventVersion?: never;
    }
);
export type AttendanceClockCommand = ClockInCommand | ClockOutCommand;

type TargetedClockOutCommand = ClockOutCommand & {
  targetAttendanceId: string;
  targetEventVersion: number;
};

function isTargetedClockOutCommand(
  command: ClockOutCommand,
): command is TargetedClockOutCommand {
  return (
    command.targetAttendanceId !== undefined &&
    command.targetEventVersion !== undefined
  );
}

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

export class AttendanceClockNotWorkingError extends AttendanceClockCommandRejectedError {
  constructor() {
    super("No working attendance exists for this user.");
    this.name = "AttendanceClockNotWorkingError";
  }
}

export type AttendanceClockServiceOptions = {
  createAttendanceId?: () => string;
};

/**
 * Executes normal clock-in and clock-out commands against attendance event
 * streams. The service replays the target user's candidate streams on every
 * command; a projection is not part of this boundary.
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
      (userStore) =>
        isTargetedClockOutCommand(command)
          ? this.executeTargetedClockOut(userStore, command)
          : this.executeClockOutWithoutTarget(userStore, command),
    );
  }

  private async executeTargetedClockOut(
    store: AttendanceEventStore,
    command: TargetedClockOutCommand,
  ): Promise<AttendanceDomainEvent> {
    const aggregates = await this.replayAll(store, command.userId);
    const target = aggregates.find(
      (aggregate) => aggregate.attendanceId === command.targetAttendanceId,
    );
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

    const workingCandidates = aggregates.filter(
      (aggregate) =>
        !aggregate.isCancelled &&
        aggregate.userId === command.userId &&
        aggregate.clockOutAt === null,
    );
    if (
      workingCandidates.length !== 1 ||
      workingCandidates[0]?.attendanceId !== command.targetAttendanceId
    ) {
      throw new AttendanceClockStaleError();
    }

    return this.appendClockOut(store, aggregates, target, command);
  }

  private async executeClockOutWithoutTarget(
    store: AttendanceEventStore,
    command: ClockOutCommand & {
      targetAttendanceId?: never;
      targetEventVersion?: never;
    },
  ): Promise<AttendanceDomainEvent> {
    const aggregates = await this.replayAll(store, command.userId);
    const workingCandidates = aggregates.filter(
      (aggregate) =>
        !aggregate.isCancelled &&
        aggregate.userId === command.userId &&
        aggregate.clockOutAt === null,
    );
    if (workingCandidates.length === 0)
      throw new AttendanceClockNotWorkingError();
    throw new AttendanceClockStaleError();
  }

  private async appendClockOut(
    store: AttendanceEventStore,
    aggregates: AttendanceAggregate[],
    target: AttendanceAggregate,
    command: TargetedClockOutCommand,
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
    const active = aggregates.map((aggregate) => aggregate.state);
    const candidate = target.state;
    const candidateInterval = toAttendanceTimeInterval(candidate);
    if (candidateInterval !== null) {
      if (findAttendanceTimeOverlap(candidate, active))
        throw new AttendanceTimeOverlapError();
    }
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
    const aggregates = await this.replayAll(store, command.userId);
    const matchingActive = aggregates.filter(
      (aggregate) =>
        !aggregate.isCancelled && aggregate.userId === command.userId,
    );
    if (matchingActive.some((aggregate) => aggregate.clockOutAt === null)) {
      throw new AttendanceClockAlreadyWorkingError();
    }
    if (
      findAttendanceClockInTimeOverlap(
        command.userId,
        command.occurredAt,
        aggregates.map((aggregate) => aggregate.state),
      ) !== null
    ) {
      throw new AttendanceTimeOverlapError();
    }
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
    await store.append([event], {
      expectedVersion: 0,
      performedByUserId: command.performedByUserId,
    });
    return event;
  }

  private async replayAll(
    store: AttendanceEventStore,
    userId: string,
  ): Promise<AttendanceAggregate[]> {
    return replayAttendanceEventStreams(
      await store.readStreamsByUserId(userId),
    );
  }
}

export function createAttendanceClockService(
  eventStore: AttendanceEventStore,
  options?: AttendanceClockServiceOptions,
): AttendanceClockService {
  return new AttendanceClockService(eventStore, options);
}

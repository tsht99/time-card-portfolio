import {
  assertValidAttendanceDateTime,
  deriveAttendanceDateFromClockInAt,
} from "./attendance-date.ts";

export type WorkPeriod = "day" | "night";

export type AttendanceClockedInPayload = {
  userId: string;
  attendanceDate: string;
  workPeriod: WorkPeriod;
  clockInAt: Date;
};

export type AttendanceClockedOutPayload = {
  clockOutAt: Date;
};

export type WorkPeriodCorrectedPayload = {
  workPeriod: WorkPeriod;
};

export type ClockInTimeCorrectedPayload = {
  clockInAt: Date;
};

export type ClockOutTimeCorrectedPayload = {
  clockOutAt: Date;
};

declare const emptyPayloadBrand: unique symbol;
type EmptyPayload = {
  readonly [emptyPayloadBrand]?: never;
  readonly [key: string]: never;
};

export type AttendanceClockedIn = {
  eventType: "AttendanceClockedIn";
  eventVersion: number;
  attendanceId: string;
  payload: AttendanceClockedInPayload;
};

export type AttendanceClockedOut = {
  eventType: "AttendanceClockedOut";
  eventVersion: number;
  attendanceId: string;
  payload: AttendanceClockedOutPayload;
};

export type AttendanceCancelled = {
  eventType: "AttendanceCancelled";
  eventVersion: number;
  attendanceId: string;
  payload: EmptyPayload;
};

export type WorkPeriodCorrected = {
  eventType: "WorkPeriodCorrected";
  eventVersion: number;
  attendanceId: string;
  payload: WorkPeriodCorrectedPayload;
};

export type ClockInTimeCorrected = {
  eventType: "ClockInTimeCorrected";
  eventVersion: number;
  attendanceId: string;
  payload: ClockInTimeCorrectedPayload;
};

export type ClockOutTimeCorrected = {
  eventType: "ClockOutTimeCorrected";
  eventVersion: number;
  attendanceId: string;
  payload: ClockOutTimeCorrectedPayload;
};

export type AttendanceDomainEvent =
  | AttendanceClockedIn
  | AttendanceClockedOut
  | AttendanceCancelled
  | WorkPeriodCorrected
  | ClockInTimeCorrected
  | ClockOutTimeCorrected;

export type AttendanceState = {
  attendanceId: string;
  version: number;
  attendanceDate: string | null;
  userId: string | null;
  workPeriod: WorkPeriod | null;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  isCancelled: boolean;
};

export class InvalidAttendanceTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAttendanceTransitionError";
  }
}

class InvalidAttendanceDateError extends Error {
  constructor(attendanceDate: string) {
    super(
      `Attendance attendanceDate must be a valid YYYY-MM-DD date: ${attendanceDate}`,
    );
    this.name = "InvalidAttendanceDateError";
  }
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function cloneState(state: AttendanceState): AttendanceState {
  return {
    ...state,
    clockInAt: state.clockInAt === null ? null : cloneDate(state.clockInAt),
    clockOutAt: state.clockOutAt === null ? null : cloneDate(state.clockOutAt),
  };
}

export function isValidAttendanceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertValidAttendanceDate(attendanceDate: string): void {
  if (!isValidAttendanceDate(attendanceDate))
    throw new InvalidAttendanceDateError(attendanceDate);
}

export class AttendanceAggregate {
  private readonly currentState: AttendanceState;

  private constructor(attendanceId: string) {
    this.currentState = {
      attendanceId,
      version: 0,
      userId: null,
      workPeriod: null,
      attendanceDate: null,
      clockInAt: null,
      clockOutAt: null,
      isCancelled: false,
    };
  }

  static start(attendanceId: string): AttendanceAggregate {
    return new AttendanceAggregate(attendanceId);
  }

  static replay(events: readonly AttendanceDomainEvent[]): AttendanceAggregate {
    if (events.length === 0) {
      throw new RangeError(
        "At least one attendance event is required to replay.",
      );
    }

    const [firstEvent] = [...events].sort(
      (a, b) => a.eventVersion - b.eventVersion,
    );
    if (firstEvent.eventType !== "AttendanceClockedIn") {
      throw new InvalidAttendanceTransitionError(
        "Attendance replay must start with a clock-in event.",
      );
    }
    const aggregate = new AttendanceAggregate(firstEvent.attendanceId);
    for (const event of [...events].sort(
      (a, b) => a.eventVersion - b.eventVersion,
    )) {
      aggregate.apply(event);
    }
    return aggregate;
  }

  get attendanceId(): string {
    return this.currentState.attendanceId;
  }
  get version(): number {
    return this.currentState.version;
  }
  get userId(): string | null {
    return this.currentState.userId;
  }
  get attendanceDate(): string | null {
    return this.currentState.attendanceDate;
  }
  get workPeriod(): WorkPeriod | null {
    return this.currentState.workPeriod;
  }
  get clockInAt(): Date | null {
    return this.currentState.clockInAt === null
      ? null
      : cloneDate(this.currentState.clockInAt);
  }
  get clockOutAt(): Date | null {
    return this.currentState.clockOutAt === null
      ? null
      : cloneDate(this.currentState.clockOutAt);
  }
  get isCancelled(): boolean {
    return this.currentState.isCancelled;
  }

  get state(): AttendanceState {
    return cloneState(this.currentState);
  }

  clockIn(payload: AttendanceClockedInPayload): AttendanceClockedIn {
    if (this.currentState.version !== 0) {
      throw new InvalidAttendanceTransitionError(
        "Attendance can only be clocked in when not started.",
      );
    }
    assertValidAttendanceDateTime(payload.clockInAt, "clockInAt");
    assertValidAttendanceDate(payload.attendanceDate);
    if (
      deriveAttendanceDateFromClockInAt(payload.clockInAt) !==
      payload.attendanceDate
    ) {
      throw new InvalidAttendanceTransitionError(
        "Attendance date must match clock-in time.",
      );
    }

    const event: AttendanceClockedIn = {
      eventType: "AttendanceClockedIn",
      eventVersion: this.currentState.version + 1,
      attendanceId: this.attendanceId,
      payload: { ...payload, clockInAt: cloneDate(payload.clockInAt) },
    };
    this.apply(event);
    return event;
  }

  clockOut(payload: AttendanceClockedOutPayload): AttendanceClockedOut {
    this.assertNotCancelled();
    if (this.currentState.version === 0) {
      throw new InvalidAttendanceTransitionError(
        "Attendance cannot be clocked out before it is clocked in.",
      );
    }
    if (this.currentState.clockOutAt !== null) {
      throw new InvalidAttendanceTransitionError(
        "Attendance has already been clocked out.",
      );
    }
    assertValidAttendanceDateTime(payload.clockOutAt, "clockOutAt");

    const event: AttendanceClockedOut = {
      eventType: "AttendanceClockedOut",
      eventVersion: this.currentState.version + 1,
      attendanceId: this.attendanceId,
      payload: { clockOutAt: cloneDate(payload.clockOutAt) },
    };
    this.apply(event);
    return event;
  }

  correctWorkPeriod(payload: WorkPeriodCorrectedPayload): WorkPeriodCorrected {
    this.assertStarted();
    this.assertNotCancelled();
    const event: WorkPeriodCorrected = {
      eventType: "WorkPeriodCorrected",
      eventVersion: this.currentState.version + 1,
      attendanceId: this.attendanceId,
      payload,
    };
    this.apply(event);
    return event;
  }

  correctClockInTime(
    payload: ClockInTimeCorrectedPayload,
  ): ClockInTimeCorrected {
    this.assertStarted();
    this.assertNotCancelled();
    assertValidAttendanceDateTime(payload.clockInAt, "clockInAt");
    const event: ClockInTimeCorrected = {
      eventType: "ClockInTimeCorrected",
      eventVersion: this.currentState.version + 1,
      attendanceId: this.attendanceId,
      payload: { clockInAt: cloneDate(payload.clockInAt) },
    };
    this.apply(event);
    return event;
  }

  correctClockOutTime(
    payload: ClockOutTimeCorrectedPayload,
  ): ClockOutTimeCorrected {
    this.assertClockOutCorrectable();
    this.assertNotCancelled();
    assertValidAttendanceDateTime(payload.clockOutAt, "clockOutAt");
    const event: ClockOutTimeCorrected = {
      eventType: "ClockOutTimeCorrected",
      eventVersion: this.currentState.version + 1,
      attendanceId: this.attendanceId,
      payload: { clockOutAt: cloneDate(payload.clockOutAt) },
    };
    this.apply(event);
    return event;
  }

  cancel(): AttendanceCancelled {
    this.assertStarted();
    this.assertNotCancelled();
    const event: AttendanceCancelled = {
      eventType: "AttendanceCancelled",
      eventVersion: this.currentState.version + 1,
      attendanceId: this.attendanceId,
      payload: {},
    };
    this.apply(event);
    return event;
  }

  private apply(event: AttendanceDomainEvent): void {
    if (event.attendanceId !== this.attendanceId) {
      throw new Error("Attendance event belongs to a different aggregate.");
    }
    if (event.eventVersion !== this.version + 1) {
      throw new Error(
        "Attendance eventVersion must be the next aggregate version.",
      );
    }

    if (event.eventType === "AttendanceClockedIn") {
      if (this.version !== 0) {
        throw new InvalidAttendanceTransitionError(
          "Attendance can only be clocked in when not started.",
        );
      }
      assertValidAttendanceDate(event.payload.attendanceDate);
      assertValidAttendanceDateTime(event.payload.clockInAt, "clockInAt");
      if (
        deriveAttendanceDateFromClockInAt(event.payload.clockInAt) !==
        event.payload.attendanceDate
      ) {
        throw new InvalidAttendanceTransitionError(
          "Attendance date must match clock-in time.",
        );
      }
      this.currentState.userId = event.payload.userId;
      this.currentState.attendanceDate = event.payload.attendanceDate;
      this.currentState.workPeriod = event.payload.workPeriod;
      this.currentState.clockInAt = cloneDate(event.payload.clockInAt);
    } else if (event.eventType === "AttendanceClockedOut") {
      this.assertNotCancelled();
      if (this.version === 0) {
        throw new InvalidAttendanceTransitionError(
          "Attendance cannot be clocked out before it is clocked in.",
        );
      }
      if (this.currentState.clockOutAt !== null) {
        throw new InvalidAttendanceTransitionError(
          "Attendance has already been clocked out.",
        );
      }
      assertValidAttendanceDateTime(event.payload.clockOutAt, "clockOutAt");
      this.assertValidClockRange(
        this.currentState.clockInAt,
        event.payload.clockOutAt,
      );
      this.currentState.clockOutAt = cloneDate(event.payload.clockOutAt);
    } else if (event.eventType === "AttendanceCancelled") {
      this.assertStarted();
      this.assertNotCancelled();
      this.currentState.isCancelled = true;
    } else {
      this.assertStarted();
      this.assertNotCancelled();
      switch (event.eventType) {
        case "WorkPeriodCorrected":
          this.currentState.workPeriod = event.payload.workPeriod;
          break;
        case "ClockInTimeCorrected":
          assertValidAttendanceDateTime(event.payload.clockInAt, "clockInAt");
          this.assertValidClockRange(
            event.payload.clockInAt,
            this.currentState.clockOutAt,
          );
          this.currentState.clockInAt = cloneDate(event.payload.clockInAt);
          this.currentState.attendanceDate = deriveAttendanceDateFromClockInAt(
            event.payload.clockInAt,
          );
          break;
        case "ClockOutTimeCorrected":
          this.assertClockOutCorrectable();
          assertValidAttendanceDateTime(event.payload.clockOutAt, "clockOutAt");
          this.assertValidClockRange(
            this.currentState.clockInAt,
            event.payload.clockOutAt,
          );
          this.currentState.clockOutAt = cloneDate(event.payload.clockOutAt);
          break;
        default: {
          const exhaustiveCheck: never = event;
          throw new Error(`Unhandled attendance event: ${exhaustiveCheck}`);
        }
      }
    }

    this.currentState.version = event.eventVersion;
  }

  private assertStarted(): void {
    if (this.currentState.version === 0) {
      throw new InvalidAttendanceTransitionError(
        "Attendance must be clocked in before it can be corrected.",
      );
    }
  }

  private assertNotCancelled(): void {
    if (this.currentState.isCancelled) {
      throw new InvalidAttendanceTransitionError(
        "Cancelled attendance is a terminal state.",
      );
    }
  }

  private assertClockOutCorrectable(): void {
    if (this.currentState.clockOutAt === null) {
      throw new InvalidAttendanceTransitionError(
        "Attendance must be clocked out before its clock-out time can be corrected.",
      );
    }
  }

  private assertValidClockRange(
    clockInAt: Date | null,
    clockOutAt: Date | null,
  ): void {
    if (
      clockInAt !== null &&
      clockOutAt !== null &&
      clockOutAt.getTime() < clockInAt.getTime()
    ) {
      throw new InvalidAttendanceTransitionError(
        "Attendance clock-out time cannot be earlier than clock-in time.",
      );
    }
  }
}

export type AttendanceListStatus = "working" | "completed";

export function calculateWorkedMinutes(
  clockInAt: Date,
  clockOutAt: Date,
): number {
  const elapsedMilliseconds = clockOutAt.getTime() - clockInAt.getTime();

  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw new RangeError("clockOutAt must not be earlier than clockInAt.");
  }

  return Math.floor(elapsedMilliseconds / 60_000);
}

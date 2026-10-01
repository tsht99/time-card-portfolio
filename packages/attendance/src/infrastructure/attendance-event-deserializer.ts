import {
  type AttendanceDomainEvent,
  isValidAttendanceDate,
} from "../domain/attendance.ts";
import type { attendanceEvents } from "../schema/attendance-events.ts";
import type { StoredAttendanceEvent } from "./attendance-event-store.ts";
import { isSafeAttendanceId } from "./attendance-id.ts";

export class AttendanceEventStoreCorruptionError extends Error {
  declare readonly attendanceId?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; attendanceId?: unknown },
  ) {
    super(message, options);
    this.name = "AttendanceEventStoreCorruptionError";
    const attendanceId = options?.attendanceId;
    if (isSafeAttendanceId(attendanceId))
      Object.defineProperty(this, "attendanceId", {
        configurable: false,
        enumerable: true,
        value: attendanceId,
        writable: false,
      });
  }
}

type PersistedPayload = Record<string, unknown>;

function corruption(message: string): never {
  throw new AttendanceEventStoreCorruptionError(
    `Attendance event store corruption: ${message}`,
  );
}

function requirePersistedPayload(
  value: unknown,
  eventType: AttendanceDomainEvent["eventType"],
  requiredFields: readonly string[],
): PersistedPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return corruption(`${eventType} payload must be an object.`);
  }
  const payload = value as PersistedPayload;
  for (const field of requiredFields) {
    if (!Object.hasOwn(payload, field)) {
      return corruption(`${eventType} payload is missing ${field}.`);
    }
  }
  for (const field of Object.keys(payload)) {
    if (!requiredFields.includes(field)) {
      return corruption(
        `${eventType} payload contains unexpected field ${field}.`,
      );
    }
  }
  return payload;
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0)
    return corruption(`${description} must be a non-empty string.`);
  return value;
}

function requireAttendanceDate(value: unknown, description: string): string {
  const attendanceDate = requireString(value, description);
  if (!isValidAttendanceDate(attendanceDate)) {
    return corruption(`${description} must be a valid YYYY-MM-DD date.`);
  }
  return attendanceDate;
}

function requireWorkPeriod(
  value: unknown,
  description: string,
): "day" | "night" {
  if (value !== "day" && value !== "night")
    return corruption(`${description} must be day or night.`);
  return value;
}

function requireTimestamp(value: unknown, description: string): Date {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return corruption(`${description} must be an ISO timestamp string.`);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()))
    return corruption(`${description} must be a valid ISO timestamp.`);
  return timestamp;
}

function requireStoredDate(value: unknown, description: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return corruption(`${description} must be a valid timestamp.`);
  return value;
}

export function deserializeAttendanceEvent(
  row: typeof attendanceEvents.$inferSelect,
): StoredAttendanceEvent {
  const safeAttendanceId = isSafeAttendanceId(row.attendanceId)
    ? row.attendanceId
    : undefined;
  try {
    const eventType = row.eventType;
    const eventId = requireString(row.eventId, "eventId");
    const performedByUserId = requireString(
      row.performedByUserId,
      "performedByUserId",
    );
    const attendanceId = requireString(row.attendanceId, "attendanceId");
    if (!Number.isInteger(row.eventVersion) || row.eventVersion < 1)
      return corruption("eventVersion must be a positive integer.");
    const createdAt = requireStoredDate(row.createdAt, "createdAt");
    const base = {
      eventId,
      performedByUserId,
      eventVersion: row.eventVersion,
      attendanceId,
      createdAt,
    };
    const payload = row.payload;
    switch (eventType) {
      case "AttendanceClockedIn": {
        const value = requirePersistedPayload(payload, eventType, [
          "userId",
          "workPeriod",
          "attendanceDate",
          "clockInAt",
        ]);
        const clockedInPayload = {
          userId: requireString(value.userId, "userId"),
          workPeriod: requireWorkPeriod(value.workPeriod, "workPeriod"),
          attendanceDate: requireAttendanceDate(
            value.attendanceDate,
            "attendanceDate",
          ),
          clockInAt: requireTimestamp(value.clockInAt, "clockInAt"),
        };
        return {
          ...base,
          eventType,
          payload: clockedInPayload,
        };
      }
      case "AttendanceClockedOut": {
        const value = requirePersistedPayload(payload, eventType, [
          "clockOutAt",
        ]);
        return {
          ...base,
          eventType,
          payload: {
            clockOutAt: requireTimestamp(value.clockOutAt, "clockOutAt"),
          },
        };
      }
      case "WorkPeriodCorrected": {
        const value = requirePersistedPayload(payload, eventType, [
          "workPeriod",
        ]);
        return {
          ...base,
          eventType,
          payload: {
            workPeriod: requireWorkPeriod(value.workPeriod, "workPeriod"),
          },
        };
      }
      case "ClockInTimeCorrected": {
        const value = requirePersistedPayload(payload, eventType, [
          "clockInAt",
        ]);
        return {
          ...base,
          eventType,
          payload: {
            clockInAt: requireTimestamp(value.clockInAt, "clockInAt"),
          },
        };
      }
      case "ClockOutTimeCorrected": {
        const value = requirePersistedPayload(payload, eventType, [
          "clockOutAt",
        ]);
        return {
          ...base,
          eventType,
          payload: {
            clockOutAt: requireTimestamp(value.clockOutAt, "clockOutAt"),
          },
        };
      }
      case "AttendanceCancelled":
        requirePersistedPayload(payload, eventType, []);
        return { ...base, eventType, payload: {} };
      default:
        return corruption(`Unknown eventType: ${eventType}.`);
    }
  } catch (error) {
    if (
      error instanceof AttendanceEventStoreCorruptionError &&
      error.attendanceId === undefined &&
      safeAttendanceId !== undefined
    ) {
      Object.defineProperty(error, "attendanceId", {
        configurable: false,
        enumerable: true,
        value: safeAttendanceId,
        writable: false,
      });
    }
    throw error;
  }
}

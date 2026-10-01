import type { WorkPeriod } from "./attendance.ts";

const attendanceTimeOverlapMessage =
  "既存の勤怠と勤務時間が重複しています。時刻を確認してください。";

export class AttendanceTimeOverlapError extends Error {
  constructor(message = attendanceTimeOverlapMessage) {
    super(message);
    this.name = "AttendanceTimeOverlapError";
  }
}

/** An attendance state used for overlap checks. */
export type AttendanceOverlapRecord = {
  attendanceId: string;
  userId: string | null;
  workPeriod?: WorkPeriod | null;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  isCancelled?: boolean;
};

export type AttendanceTimeInterval = {
  attendanceId: string;
  userId: string;
  clockInAt: Date;
  clockOutAt: Date;
};

function hasRecordedClockTimes(
  attendance: AttendanceOverlapRecord,
): attendance is AttendanceOverlapRecord & {
  userId: string;
  clockInAt: Date;
  clockOutAt: Date;
} {
  return (
    attendance.isCancelled !== true &&
    attendance.userId !== null &&
    attendance.clockInAt !== null &&
    attendance.clockOutAt !== null &&
    attendance.clockInAt.getTime() < attendance.clockOutAt.getTime()
  );
}

/** Converts an attendance to a comparable interval, or null if it is not final. */
export function toAttendanceTimeInterval(
  attendance: AttendanceOverlapRecord,
): AttendanceTimeInterval | null {
  if (!hasRecordedClockTimes(attendance)) return null;
  return {
    attendanceId: attendance.attendanceId,
    userId: attendance.userId,
    clockInAt: attendance.clockInAt,
    clockOutAt: attendance.clockOutAt,
  };
}

/** Returns whether two valid intervals overlap as half-open intervals. */
function attendanceIntervalsOverlap(
  left: AttendanceTimeInterval,
  right: AttendanceTimeInterval,
): boolean {
  return (
    left.clockInAt.getTime() < right.clockOutAt.getTime() &&
    right.clockInAt.getTime() < left.clockOutAt.getTime()
  );
}

function findComparableAttendanceIntervals(
  userId: string,
  existing: readonly AttendanceOverlapRecord[],
): AttendanceTimeInterval[] {
  const intervals: AttendanceTimeInterval[] = [];
  for (const attendance of existing) {
    const interval = toAttendanceTimeInterval(attendance);
    if (interval !== null && interval.userId === userId)
      intervals.push(interval);
  }
  return intervals;
}

/**
 * Finds the first finalized attendance containing a user's clock-in time.
 * The start of an existing interval is inclusive and its end is exclusive.
 */
export function findAttendanceClockInTimeOverlap(
  userId: string,
  clockInAt: Date,
  existing: readonly AttendanceOverlapRecord[],
): AttendanceTimeInterval | null {
  const clockInTime = clockInAt.getTime();
  for (const interval of findComparableAttendanceIntervals(userId, existing)) {
    if (
      interval.clockInAt.getTime() <= clockInTime &&
      clockInTime < interval.clockOutAt.getTime()
    ) {
      return interval;
    }
  }
  return null;
}

/**
 * Finds the first comparable attendance that overlaps the candidate. Invalid,
 * cancelled, different-user, and self records are ignored.
 */
export function findAttendanceTimeOverlap(
  candidate: AttendanceOverlapRecord,
  existing: readonly AttendanceOverlapRecord[],
): AttendanceTimeInterval | null {
  const candidateInterval = toAttendanceTimeInterval(candidate);
  if (candidateInterval === null) return null;

  for (const existingInterval of findComparableAttendanceIntervals(
    candidateInterval.userId,
    existing,
  )) {
    if (
      existingInterval.attendanceId !== candidate.attendanceId &&
      attendanceIntervalsOverlap(candidateInterval, existingInterval)
    ) {
      return existingInterval;
    }
  }
  return null;
}

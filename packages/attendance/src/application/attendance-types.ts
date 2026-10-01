import type { AttendanceListStatus, WorkPeriod } from "../domain/attendance.ts";

export type CreateAttendanceEventInput =
  | { workPeriod: WorkPeriod; eventType: "clock_in"; time: string }
  | {
      workPeriod: WorkPeriod;
      eventType: "clock_out";
      time: string;
      targetAttendanceId: string;
      targetEventVersion: number;
    }
  | { workPeriod: WorkPeriod; eventType: "clock_out"; time: string };

export type CorrectAttendanceInput = {
  expectedVersion: number;
  workPeriod?: WorkPeriod;
  clockInAt?: string;
  clockOutAt?: string;
};

export type CreateAdminAttendanceInput = {
  userId: string;
  workPeriod: WorkPeriod;
  clockInAt: string;
  clockOutAt: string;
};

export type CancelAttendanceInput = { expectedVersion: number };

export type StaffAttendanceItem = {
  attendanceId: string;
  eventVersion: number;
  attendanceDate: string;
  workPeriod: WorkPeriod;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number | null;
};

export type StaffCurrentAttendance = {
  referenceDate: string;
  attendances: StaffAttendanceItem[];
};

export type AttendanceListItem = {
  attendanceId: string;
  eventVersion: number;
  attendanceDate: string;
  userId: string;
  displayName: string | null;
  workPeriod: WorkPeriod;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number | null;
  status: AttendanceListStatus;
};

export type CancelledAttendanceListItem = {
  attendanceId: string;
  attendanceDate: string;
  userId: string;
  displayName: string | null;
  workPeriod: WorkPeriod;
  clockInAt: string;
};

type AttendanceEventHistoryMetadata = {
  eventId: string;
  attendanceId: string;
  eventVersion: number;
  performedByUserId: string;
  createdAt: string;
};

type EmptyHistoryPayload = { readonly [key: string]: never };

export type AttendanceEventHistoryItem =
  | (AttendanceEventHistoryMetadata & {
      eventType: "AttendanceClockedIn";
      payload: {
        userId: string;
        attendanceDate: string;
        workPeriod: WorkPeriod;
        clockInAt: string;
      };
    })
  | (AttendanceEventHistoryMetadata & {
      eventType: "AttendanceClockedOut";
      payload: { clockOutAt: string };
    })
  | (AttendanceEventHistoryMetadata & {
      eventType: "WorkPeriodCorrected";
      payload: { workPeriod: WorkPeriod };
    })
  | (AttendanceEventHistoryMetadata & {
      eventType: "ClockInTimeCorrected";
      payload: { clockInAt: string };
    })
  | (AttendanceEventHistoryMetadata & {
      eventType: "ClockOutTimeCorrected";
      payload: { clockOutAt: string };
    })
  | (AttendanceEventHistoryMetadata & {
      eventType: "AttendanceCancelled";
      payload: EmptyHistoryPayload;
    });

export type AttendanceDetail = {
  attendanceId: string;
  eventVersion: number;
  attendanceDate: string;
  userId: string;
  displayName: string | null;
  workPeriod: WorkPeriod;
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number | null;
  status: AttendanceListStatus | "cancelled";
  history: AttendanceEventHistoryItem[];
};

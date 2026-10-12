import type {
  AttendanceEventHistoryItem as AttendanceApplicationEventHistoryItem,
  AttendanceDetail,
  AttendanceListItem,
  WorkPeriod as AttendanceWorkPeriod,
  CancelledAttendanceListItem,
  AttendanceStatus as DomainAttendanceStatus,
  StaffAttendanceItem,
  StaffCurrentAttendance,
} from "@repo/attendance";
import { z } from "zod";

export const workPeriods = ["day", "night"] as const;
export type WorkPeriod = AttendanceWorkPeriod;
export const attendanceOperationalStatuses = ["working", "completed"] as const;
export type AttendanceEventType = "clock_in" | "clock_out";
export type AttendanceStatus = DomainAttendanceStatus;
const attendanceDateTimeSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(new Date(value).getTime()), {
    message: "日時は有効なISO 8601 datetimeで指定してください。",
  })
  .refine((value) => /:00(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value), {
    message: "日時は分単位で指定してください。",
  });

export const attendanceIdSchema = z.uuid({
  message: "勤怠IDはUUID形式で指定してください。",
});

const attendanceUserIdSchema = z.uuid("userId はUUID形式で指定してください。");

export const createAttendanceEventRequestSchema = z.union([
  z
    .object({
      workPeriod: z.enum(workPeriods),
      eventType: z.literal("clock_in"),
      occurredAt: attendanceDateTimeSchema,
    })
    .strict(),
  z
    .object({
      workPeriod: z.enum(workPeriods),
      eventType: z.literal("clock_out"),
      occurredAt: attendanceDateTimeSchema,
      targetAttendanceId: attendanceIdSchema,
      targetEventVersion: z.number().int().positive(),
    })
    .strict(),
]);

export type CreateAttendanceEventRequest = z.infer<
  typeof createAttendanceEventRequestSchema
>;

export const correctAttendanceRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    workPeriod: z.enum(workPeriods).optional(),
    clockInAt: attendanceDateTimeSchema.optional(),
    clockOutAt: attendanceDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.workPeriod !== undefined ||
      value.clockInAt !== undefined ||
      value.clockOutAt !== undefined,
    {
      message: "少なくとも1つの訂正項目を指定してください。",
    },
  );

export const createAdminAttendanceRequestSchema = z
  .object({
    userId: attendanceUserIdSchema,
    workPeriod: z.enum(workPeriods),
    clockInAt: attendanceDateTimeSchema,
    clockOutAt: attendanceDateTimeSchema,
  })
  .strict();

export const cancelAttendanceRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export type {
  AttendanceListItem,
  CancelledAttendanceListItem,
  StaffAttendanceItem,
  StaffCurrentAttendance,
};

export type AttendanceEventHistoryItem = AttendanceApplicationEventHistoryItem;
export type AdminAttendanceDetail = Omit<
  AttendanceDetail,
  "history" | "status"
> & {
  status: AttendanceStatus;
  payrollEstimate: {
    hourlyWage: number | null;
    estimatedPayYen: number | null;
    status:
      | "calculated"
      | "missingHourlyWage"
      | "clockOutMissing"
      | "incomplete"
      | "excluded";
  };
  history: AttendanceEventHistoryItem[];
};

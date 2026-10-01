import type {
  AttendanceEventHistoryItem as AttendanceApplicationEventHistoryItem,
  AttendanceDetail,
  AttendanceListItem,
  WorkPeriod as AttendanceWorkPeriod,
  CancelledAttendanceListItem,
  AttendanceListStatus as DomainAttendanceListStatus,
  StaffAttendanceItem,
  StaffCurrentAttendance,
} from "@repo/attendance";
import { z } from "zod";

export const workPeriods = ["day", "night"] as const;
export type WorkPeriod = AttendanceWorkPeriod;
export const attendanceListStatuses = ["working", "completed"] as const;
export type AttendanceEventType = "clock_in" | "clock_out";
export type AttendanceListStatus = DomainAttendanceListStatus;
const attendanceDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(new Date(value).getTime()), {
    message: "日時は有効なISO 8601 datetimeで指定してください。",
  })
  .refine((value) => /:00(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value), {
    message: "日時は分単位で指定してください。",
  });

const attendanceTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
  message: "時刻はHH:mm形式で指定してください。",
});

export const attendanceIdSchema = z.string().uuid({
  message: "勤怠IDはUUID形式で指定してください。",
});

export const createAttendanceEventRequestSchema = z.union([
  z
    .object({
      workPeriod: z.enum(workPeriods),
      eventType: z.literal("clock_in"),
      time: attendanceTimeSchema,
    })
    .strict(),
  z
    .object({
      workPeriod: z.enum(workPeriods),
      eventType: z.literal("clock_out"),
      time: attendanceTimeSchema,
      targetAttendanceId: attendanceIdSchema,
      targetEventVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      workPeriod: z.enum(workPeriods),
      eventType: z.literal("clock_out"),
      time: attendanceTimeSchema,
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

export type CorrectAttendanceRequest = z.infer<
  typeof correctAttendanceRequestSchema
>;

export const createAdminAttendanceRequestSchema = z
  .object({
    userId: z.string(),
    workPeriod: z.enum(workPeriods),
    clockInAt: attendanceDateTimeSchema,
    clockOutAt: attendanceDateTimeSchema,
  })
  .strict();

export type CreateAdminAttendanceRequest = z.infer<
  typeof createAdminAttendanceRequestSchema
>;

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
  status: AttendanceListStatus | "cancelled";
  payroll: {
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

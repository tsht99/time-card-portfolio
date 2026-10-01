import { z } from "zod";
import { attendanceListStatuses, workPeriods } from "./attendance.ts";

export const yearMonthSchema = z
  .string({ error: "month は YYYY-MM 形式で指定してください。" })
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])$/,
    "month は YYYY-MM 形式で指定してください。",
  );

const dateSchema = z
  .string({ error: "from と to は YYYY-MM-DD 形式で指定してください。" })
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "from と to は YYYY-MM-DD 形式で指定してください。",
  )
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().startsWith(`${value}T`)
    );
  }, "from と to は YYYY-MM-DD 形式で指定してください。");

const attendanceListFiltersSchema = z.object({
  userId: z.string().uuid("userId はUUID形式で指定してください。").optional(),
  workPeriod: z
    .enum(workPeriods, {
      error: "workPeriod は day または night で指定してください。",
    })
    .optional(),
  status: z
    .enum(attendanceListStatuses, {
      error: "status は working または completed で指定してください。",
    })
    .optional(),
});

export const attendanceListQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    ...attendanceListFiltersSchema.shape,
  })
  .superRefine((query, context) => {
    if (query.from > query.to) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from と to は YYYY-MM-DD 形式で指定してください。",
      });
    }
  });

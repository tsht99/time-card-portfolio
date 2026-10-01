import { z } from "zod";
import {
  hourlyWageDayTypes,
  isValidAttendanceDate,
  isValidHourlyWage,
  workPeriods,
} from "../domain/hourly-wage-rate.ts";

const effectiveFromSchema = z
  .string({
    error: "effectiveFrom は実在する YYYY-MM-DD 日付で指定してください。",
  })
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "effectiveFrom は実在する YYYY-MM-DD 日付で指定してください。",
  )
  .refine(
    isValidAttendanceDate,
    "effectiveFrom は実在する YYYY-MM-DD 日付で指定してください。",
  );

export const createHourlyWageRateRequestSchema = z
  .object({
    workPeriod: z.enum(workPeriods, {
      error: "workPeriod は day または night で指定してください。",
    }),
    dayType: z.enum(hourlyWageDayTypes, {
      error: "dayType の指定が正しくありません。",
    }),
    hourlyWage: z
      .number({
        error: "hourlyWage は0以上99,999以下の整数で指定してください。",
      })
      .refine(
        isValidHourlyWage,
        "hourlyWage は0以上99,999以下の整数で指定してください。",
      ),
    effectiveFrom: effectiveFromSchema,
  })
  .strict();

export const updateHourlyWageRateRequestSchema =
  createHourlyWageRateRequestSchema
    .extend({
      expectedVersion: z.number().int().positive(),
    })
    .strict();

export const deleteHourlyWageRateRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const hourlyWageRateBaselineSchema = z
  .object({ id: z.string().uuid(), version: z.number().int().positive() })
  .strict();

export const bulkUpdateHourlyWageRatesRequestSchema = z
  .object({
    effectiveFrom: effectiveFromSchema,
    changes: z
      .array(
        z
          .object({
            dayType: z.enum(hourlyWageDayTypes),
            workPeriod: z.enum(workPeriods),
            hourlyWage: z.number().refine(isValidHourlyWage),
            expectedBaseline: hourlyWageRateBaselineSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .superRefine(({ changes }, context) => {
    const seen = new Set<string>();
    changes.forEach((change, index) => {
      const key = `${change.dayType}:${change.workPeriod}`;
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          path: ["changes", index],
          message: "同じ曜日・勤務区分を重複指定できません。",
        });
      seen.add(key);
    });
  });

type CreateHourlyWageRateRequest = z.infer<
  typeof createHourlyWageRateRequestSchema
>;

export type UpdateHourlyWageRateRequest = z.infer<
  typeof updateHourlyWageRateRequestSchema
>;

export type BulkUpdateHourlyWageRatesRequest = z.infer<
  typeof bulkUpdateHourlyWageRatesRequestSchema
>;

export type HourlyWageRateResource = CreateHourlyWageRateRequest & {
  id: string;
  userId: string;
  version: number;
  createdAt: string;
};

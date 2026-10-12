import {
  hourlyWageDayTypes,
  isValidAttendanceDate,
  isValidHourlyWage,
  MAX_HOURLY_WAGE,
  workPeriods,
} from "@repo/payroll";
import { z } from "zod";

export { MAX_HOURLY_WAGE };

const hourlyWageErrorMessage = `hourlyWage は0以上${MAX_HOURLY_WAGE.toLocaleString("en-US")}以下の整数で指定してください。`;

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

export const createHourlyWageRuleRequestSchema = z
  .object({
    workPeriod: z.enum(workPeriods, {
      error: "workPeriod は day または night で指定してください。",
    }),
    dayType: z.enum(hourlyWageDayTypes, {
      error: "dayType の指定が正しくありません。",
    }),
    hourlyWage: z
      .number({
        error: hourlyWageErrorMessage,
      })
      .refine(isValidHourlyWage, hourlyWageErrorMessage),
    effectiveFrom: effectiveFromSchema,
  })
  .strict();

export const updateHourlyWageRuleRequestSchema =
  createHourlyWageRuleRequestSchema
    .extend({
      expectedVersion: z.number().int().positive(),
    })
    .strict();

export const deleteHourlyWageRuleRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const hourlyWageRuleBaselineSchema = z
  .object({ id: z.uuid(), version: z.number().int().positive() })
  .strict();

export const bulkUpdateHourlyWageRulesRequestSchema = z
  .object({
    effectiveFrom: effectiveFromSchema,
    changes: z
      .array(
        z
          .object({
            dayType: z.enum(hourlyWageDayTypes),
            workPeriod: z.enum(workPeriods),
            hourlyWage: z.number().refine(isValidHourlyWage),
            expectedBaseline: hourlyWageRuleBaselineSchema.nullable(),
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

type CreateHourlyWageRuleRequest = z.infer<
  typeof createHourlyWageRuleRequestSchema
>;

export type UpdateHourlyWageRuleRequest = z.infer<
  typeof updateHourlyWageRuleRequestSchema
>;

export type BulkUpdateHourlyWageRulesRequest = z.infer<
  typeof bulkUpdateHourlyWageRulesRequestSchema
>;

export type HourlyWageRuleResponse = CreateHourlyWageRuleRequest & {
  id: string;
  userId: string;
  version: number;
  createdAt: string;
};

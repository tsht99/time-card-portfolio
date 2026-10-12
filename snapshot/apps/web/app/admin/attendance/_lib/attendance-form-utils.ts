import { createAdminAttendanceRequestSchema } from "@repo/contracts";
import { z } from "zod";

export function toTokyoDateTimeRequest(value: string) {
  return `${value}:00+09:00`;
}

export const datetimeLocalFormSchema = (requiredMessage: string) =>
  z.string().superRefine((value, context) => {
    if (value === "") {
      context.addIssue({ code: "custom", message: requiredMessage });
      return;
    }
    const parsed = createAdminAttendanceRequestSchema.shape.clockInAt.safeParse(
      toTokyoDateTimeRequest(value),
    );
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message:
          parsed.error.issues[0]?.message ??
          "日時は有効なISO 8601 datetimeで指定してください。",
      });
    }
  });

export function setContractFieldErrors<TField extends string>(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  setError: (name: TField, error: { message: string }) => void,
  fields: readonly TField[],
) {
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && fields.includes(field as TField)) {
      setError(field as TField, { message: issue.message });
    }
  }
}

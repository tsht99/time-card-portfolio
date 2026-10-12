import type { UserAccessState } from "@repo/users";
import { z } from "zod";

export type UserListItem = UserAccessState;

export const updateUserAccessStatusRequestSchema = z
  .object({
    status: z.enum(["active", "inactive"], {
      error: "status は active または inactive で指定してください。",
    }),
  })
  .strict();

export const updateUserDisplayNameRequestSchema = z
  .object({
    displayName: z.string().trim().min(1),
  })
  .strict();

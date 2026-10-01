import type { UserRole, UserStatus } from "@repo/users";
import { z } from "zod";

export type UserListItem = {
  userId: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
};

export const updateUserStatusRequestSchema = z
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

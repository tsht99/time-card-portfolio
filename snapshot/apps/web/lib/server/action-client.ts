import "server-only";

import {
  createSafeActionClient,
  createValidatedMiddleware,
  returnServerError as returnNativeServerError,
} from "next-safe-action";
import { z } from "zod";
import { resolveAuthenticatedUserSession } from "./auth-session";
import { reportUnexpectedServerException } from "./server-observability";

const actionMetadataSchema = z.object({
  operation: z.string().min(1),
  fallback: z.string().min(1),
});

export type ExpectedActionError = { code: string; message: string };

export function returnServerError(error: ExpectedActionError): never {
  return returnNativeServerError(error);
}

export const actionClient = createSafeActionClient({
  defineMetadataSchema: () => actionMetadataSchema,
  handleServerError(error, { metadata }) {
    reportUnexpectedServerException(error, metadata.operation);
    return { code: "INTERNAL_SERVER_ERROR", message: metadata.fallback };
  },
});

export const authenticatedActionMiddleware = createValidatedMiddleware<{
  ctx: object;
  parsedInput: unknown;
}>().define(async ({ next }) => {
  const session = await resolveAuthenticatedUserSession();
  return next({
    ctx: {
      session:
        session.status === "ready"
          ? ({ status: "ready", user: session.user } as const)
          : session,
    },
  });
});

export type ActionSession = Exclude<
  Awaited<ReturnType<typeof resolveAuthenticatedUserSession>>,
  { status: "ready" }
>;

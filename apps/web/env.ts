import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    SENTRY_ORG: z.string().min(1).optional(),
    SENTRY_PROJECT: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_LIFF_ID: z.string().min(1).optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    NEXT_PUBLIC_SENTRY_RELEASE: z.string().min(1).optional(),
  },
  runtimeEnv: {
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    NEXT_PUBLIC_LIFF_ID: process.env.NEXT_PUBLIC_LIFF_ID,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    NEXT_PUBLIC_SENTRY_RELEASE:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  },
  emptyStringAsUndefined: true,
});

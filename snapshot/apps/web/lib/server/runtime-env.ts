import "server-only";

import { z } from "zod";

const positiveFiniteNumber = z.coerce.number().positive();
const nonEmptyString = z.string().min(1);
const optionalUrl = z.url().optional();
const optionalNonEmptyString = nonEmptyString.optional();

export type SentryRuntimeConfiguration = {
  dsn: string;
  environment: string;
  release: string;
};

function readEnvironmentVariable(name: string): string | undefined {
  const value = process.env[name];
  return value === "" ? undefined : value;
}

function parseConfiguration<T>(
  name: string,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new Error(`${name} is invalid: ${result.error.message}`);
}

export function getLineChannelId(): string {
  const value = readEnvironmentVariable("LINE_CHANNEL_ID");
  if (value === undefined) throw new Error("LINE_CHANNEL_ID is not set.");
  return parseConfiguration("LINE_CHANNEL_ID", nonEmptyString, value);
}

export function getSessionTtlHours(): number {
  return parseConfiguration(
    "SESSION_TTL_HOURS",
    positiveFiniteNumber.default(24),
    readEnvironmentVariable("SESSION_TTL_HOURS"),
  );
}

export function getSentryRuntimeConfiguration():
  | SentryRuntimeConfiguration
  | undefined {
  const dsn = parseConfiguration(
    "SENTRY_DSN",
    optionalUrl,
    readEnvironmentVariable("SENTRY_DSN"),
  );
  const environment = parseConfiguration(
    "SENTRY_ENVIRONMENT",
    optionalNonEmptyString,
    readEnvironmentVariable("SENTRY_ENVIRONMENT"),
  );
  const release = parseConfiguration(
    "SENTRY_RELEASE",
    optionalNonEmptyString,
    readEnvironmentVariable("SENTRY_RELEASE") ??
      readEnvironmentVariable("VERCEL_GIT_COMMIT_SHA"),
  );

  if (!dsn || !environment || !release) return undefined;
  return { dsn, environment, release };
}

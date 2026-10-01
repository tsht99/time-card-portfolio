import * as Sentry from "@sentry/nextjs";

import { env } from "./env";
import { sentryDataCollection } from "./lib/sentry-data-collection";

const isSentryEnvironment =
  env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "production" ||
  env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "preview";

if (
  env.NEXT_PUBLIC_SENTRY_DSN &&
  env.NEXT_PUBLIC_SENTRY_ENVIRONMENT &&
  env.NEXT_PUBLIC_SENTRY_RELEASE &&
  isSentryEnvironment
) {
  Sentry.init({
    dsn: env.NEXT_PUBLIC_SENTRY_DSN,
    environment: env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release: env.NEXT_PUBLIC_SENTRY_RELEASE,
    dataCollection: sentryDataCollection,
  });
}

import { getSentryRuntimeConfiguration } from "@repo/server/env";
import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection } from "./lib/sentry-data-collection";
import { sanitizeSentryEvent } from "./lib/sentry-event-sanitizer";

const sentry = getSentryRuntimeConfiguration();
const isSentryEnvironment =
  sentry?.environment === "production" || sentry?.environment === "preview";

if (sentry && isSentryEnvironment) {
  Sentry.init({
    dsn: sentry.dsn,
    environment: sentry.environment,
    release: sentry.release,
    dataCollection: sentryDataCollection,
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
  });
}

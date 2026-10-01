import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators:
    process.env.E2E_WEB_RUNTIME === "development" ? false : undefined,
  transpilePackages: ["@repo/ui", "@repo/server", "@repo/attendance"],
};

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryRelease =
  process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

const isSentryBuildConfigured =
  sentryAuthToken && sentryOrg && sentryProject && sentryRelease;

export default isSentryBuildConfigured
  ? withSentryConfig(nextConfig, {
      authToken: sentryAuthToken,
      org: sentryOrg,
      project: sentryProject,
      release: {
        name: sentryRelease,
      },
      sourcemaps: {
        deleteSourcemapsAfterUpload: true,
      },
    })
  : nextConfig;

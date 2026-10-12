import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

import { TEST_REFERENCE_TIME_ISO } from "web/test-support/browser/reference-time";

const webPort = 4173;
const webUrl = `http://127.0.0.1:${webPort}`;
const webRuntime = process.env.WEB_TEST_RUNTIME ?? "production";
const webDirectory = fileURLToPath(new URL(".", import.meta.url));
const webTestEnv = parseEnv(
  readFileSync(resolve(webDirectory, ".env.test"), "utf8"),
);

export default defineConfig({
  testDir: "./app",
  testMatch: /.*\.medium\.test\.ts$/,
  fullyParallel: true,
  workers: webRuntime === "development" ? 1 : undefined,
  reporter: "list",
  webServer: {
    command: "pnpm --filter web test-support:browser:webserver",
    cwd: webDirectory,
    url: webUrl,
    timeout: 180000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
    reuseExistingServer: false,
    env: {
      ...process.env,
      ...webTestEnv,
      DATABASE_ENVIRONMENT: "local",
      WEB_TEST_RUNTIME: webRuntime,
      TIMECARD_TEST_FIXED_NOW: TEST_REFERENCE_TIME_ISO,
      NEXT_PUBLIC_LIFF_ID: "e2e-admin-liff-id",
      LINE_CHANNEL_ID: "e2e-line-channel-id",
    },
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: webUrl,
    headless: true,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    launchOptions: { args: ["--lang=ja-JP"] },
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { readWebTestEnv } from "web/test-support/browser/environment";

const webTestEnv = readWebTestEnv();
const webUrl = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./recordings",
  testMatch: /tutorial-video-.*\.recording\.ts$/,
  fullyParallel: false,
  workers: 1,
  globalSetup: fileURLToPath(
    import.meta.resolve("web/test-support/browser/prepare"),
  ),
  reporter: "list",
  webServer: {
    command: "pnpm --filter web test-support:browser:webserver",
    url: webUrl,
    timeout: 180000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
    reuseExistingServer: false,
    env: {
      ...process.env,
      ...webTestEnv,
      DATABASE_ENVIRONMENT: "local",
      WEB_TEST_RUNTIME: "production",
      TIMECARD_TEST_FIXED_NOW: "2026-01-01T03:00:00.000Z",
      NEXT_PUBLIC_LIFF_ID: "e2e-admin-liff-id",
      LINE_CHANNEL_ID: "e2e-line-channel-id",
    },
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: webUrl,
    headless: true,
  },
});

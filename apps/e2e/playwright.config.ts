import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

import { E2E_REFERENCE_TIME_ISO } from "./reference-time";

const webPort = 4173;
const webUrl = `http://127.0.0.1:${webPort}`;
const webRuntime = process.env.E2E_WEB_RUNTIME ?? "production";
const webTestEnv = parseEnv(
  readFileSync(resolve(__dirname, "../web/.env.test"), "utf8"),
);

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.(small|medium|large)\.test\.ts$/,
  fullyParallel: true,
  workers: webRuntime === "development" ? 1 : undefined,
  globalSetup: "./global-setup.ts",
  reporter: "list",
  webServer: {
    command: "exec ./node_modules/.bin/tsx scripts/e2e-webserver.ts",
    cwd: __dirname,
    url: webUrl,
    timeout: 180000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
    reuseExistingServer: false,
    env: {
      ...process.env,
      ...webTestEnv,
      DATABASE_ENVIRONMENT: "local",
      E2E_WEB_RUNTIME: webRuntime,
      TIMECARD_E2E_FIXED_NOW: E2E_REFERENCE_TIME_ISO,
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

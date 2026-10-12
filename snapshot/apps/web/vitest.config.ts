import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const testEnv = parseEnv(
    readFileSync(new URL("./.env.test", import.meta.url), "utf8"),
  );
  Object.assign(process.env, testEnv);
  const storybookPlugins = await storybookTest({
    configDir: new URL("./.storybook", import.meta.url).pathname,
  });

  return {
    plugins: [react(), tsconfigPaths()],
    resolve: {
      alias: {
        "server-only": new URL(
          "./test-support/vitest/server-only.ts",
          import.meta.url,
        ).pathname,
      },
    },
    test: {
      env: testEnv,
      projects: [
        {
          test: {
            name: "small",
            include: ["**/*.small.test.*"],
            environment: "jsdom",
            setupFiles: ["./test-support/vitest/setup.ts"],
          },
        },
        {
          plugins: storybookPlugins,
          test: {
            name: "storybook-browser",
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              instances: [{ browser: "chromium" as const }],
            },
          },
        },
      ],
    },
  };
});

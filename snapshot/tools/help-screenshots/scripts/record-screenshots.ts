import { spawnSync } from "node:child_process";
import { readWebTestEnv } from "web/test-support/browser/environment";

const webTestEnv = readWebTestEnv();
const env = Object.assign({}, process.env, webTestEnv) as NodeJS.ProcessEnv;

function run(args: string[], overrides: Record<string, string> = {}) {
  const result = spawnSync("pnpm", args, {
    env: Object.assign({}, env, overrides) as NodeJS.ProcessEnv,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  return result.status === 0;
}

if (!run(["exec", "turbo", "run", "build", "--filter=web...", "--force"])) {
  process.exitCode = 1;
} else if (
  !run(
    ["exec", "playwright", "test", "--config=playwright.screenshots.config.ts"],
    {
      HELP_SCREENSHOT_RECORDING: "1",
      NEXT_PUBLIC_LIFF_ID: "e2e-admin-liff-id",
    },
  )
) {
  process.exitCode = 1;
}

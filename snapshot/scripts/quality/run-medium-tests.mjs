import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUALITY_TEST_ENV } from "./test-environment.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function getMediumTestEnv(environment = process.env) {
  return { ...QUALITY_TEST_ENV, ...environment };
}

export function runMediumTests({
  turboArguments = [],
  env = process.env,
  runCommand = (args, options) => {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(
      pnpm,
      ["exec", "turbo", "run", "test:medium", ...args, "--concurrency=1"],
      options,
    );
    return result.error || result.status !== 0 ? 1 : 0;
  },
} = {}) {
  return runCommand(turboArguments, {
    cwd: ROOT,
    env: getMediumTestEnv(env),
    stdio: "inherit",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runMediumTests({
    turboArguments: process.argv.slice(2),
  });
}

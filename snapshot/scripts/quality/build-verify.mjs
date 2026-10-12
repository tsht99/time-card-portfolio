import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUALITY_TEST_ENV } from "./test-environment.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function runBuildVerify({
  runCommand = (command, options) => {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(pnpm, [command], {
      cwd: ROOT,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });
    return result.error || result.status !== 0 ? 1 : 0;
  },
} = {}) {
  return runCommand("build", { env: QUALITY_TEST_ENV });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runBuildVerify();
}

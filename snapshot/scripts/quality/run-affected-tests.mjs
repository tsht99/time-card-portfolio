import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  return !result.error && result.status === 0;
}

export function runAffectedTests({
  size,
  env = process.env,
  runCommand = run,
} = {}) {
  if (size !== "small" && size !== "medium") {
    throw new Error(`Unknown affected test size: ${size}`);
  }

  const suffix = size === "small" ? "small" : "medium";
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  if (!runCommand(pnpm, [`test:${suffix}:scripts`], { ...process.env, ...env }))
    return 1;

  const turboArgs = ["exec", "turbo", "run", `test:${suffix}`, "--affected"];
  if (size === "medium") turboArgs.push("--concurrency=1");
  return runCommand(pnpm, turboArgs, { ...process.env, ...env }) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runAffectedTests({ size: process.argv[2] });
}

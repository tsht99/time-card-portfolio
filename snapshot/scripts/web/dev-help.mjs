import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function buildHelpDevLaunch(
  environment = process.env,
  platform = process.platform,
) {
  return {
    command: platform === "win32" ? "pnpm.cmd" : "pnpm",
    args: ["--filter", "help", "dev"],
    env: { ...environment, HELP_SCREENSHOT_BASE: "/images/generated" },
    shell: platform === "win32",
  };
}

async function run() {
  const launch = buildHelpDevLaunch();
  const child = spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    env: launch.env,
    shell: launch.shell,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();

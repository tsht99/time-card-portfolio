import { spawn } from "node:child_process";

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

export default async function globalSetup() {
  await run("pnpm", ["--filter", "@repo/db", "build"]);
  await run("pnpm", ["--filter", "@repo/server", "build"]);
  if (process.env.E2E_WEB_RUNTIME !== "development") {
    await run("pnpm", ["exec", "turbo", "run", "build", "--filter=web..."]);
  }
}

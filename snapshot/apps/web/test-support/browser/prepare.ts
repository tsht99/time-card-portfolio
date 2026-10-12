import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readWebTestEnv } from "./environment.ts";
import { getProductionBuildEnv } from "./production-build-env.ts";

type RunCommand = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<void>;

const run: RunCommand = (command, args, env) => {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
};

export async function prepareBrowserTests(
  runCommand: RunCommand = run,
  environment: NodeJS.ProcessEnv = process.env,
) {
  await runCommand("pnpm", ["--filter", "@repo/db", "build"], environment);
  if (
    environment.WEB_TEST_RUNTIME !== "development" &&
    environment.HELP_SCREENSHOT_RECORDING !== "1"
  ) {
    await runCommand(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=web..."],
      getProductionBuildEnv(environment, readWebTestEnv()),
    );
  }
}

export default async function globalSetup() {
  await prepareBrowserTests();
}

const invokedAsCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsCli) {
  prepareBrowserTests().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testGlobs = process.argv.slice(2);
if (testGlobs.length === 0) {
  process.stderr.write("Usage: medium-test <test-glob> [...test-globs]\n");
  process.exitCode = 2;
} else {
  const tsxLoader = import.meta.resolve("tsx");
  const globalSetup = fileURLToPath(
    new URL("../src/medium-postgres-global-setup.ts", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      tsxLoader,
      "--test",
      "--test-global-setup",
      globalSetup,
      "--test-concurrency=1",
      ...testGlobs,
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
  } else if (result.signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}

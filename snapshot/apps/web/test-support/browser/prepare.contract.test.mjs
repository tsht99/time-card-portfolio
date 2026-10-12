import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareBrowserTests } from "./prepare.ts";

const prepareUrl = new URL("./prepare.ts", import.meta.url).href;

function createPnpmStub(directory) {
  const path = join(directory, "pnpm");
  writeFileSync(
    path,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PREPARE_COMMAND_LOG"\n',
  );
  chmodSync(path, 0o755);
  return path;
}

test("importing preparation has no side effects", () => {
  const directory = mkdtempSync(join(tmpdir(), "web-prepare-import-"));
  try {
    createPnpmStub(directory);
    const logPath = join(directory, "commands.log");
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(prepareUrl)})`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: directory,
          PREPARE_COMMAND_LOG: logPath,
          WEB_TEST_RUNTIME: "development",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => readFileSync(logPath, "utf8"), { code: "ENOENT" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preparation preserves runtime conditions", async () => {
  const commands = [];
  await prepareBrowserTests(
    async (command, args) => {
      commands.push({ command, args });
    },
    { WEB_TEST_RUNTIME: "development" },
  );

  assert.deepEqual(commands, [
    { command: "pnpm", args: ["--filter", "@repo/db", "build"] },
  ]);
});

test("default Playwright setup is callable", () => {
  const directory = mkdtempSync(join(tmpdir(), "web-prepare-setup-"));
  try {
    createPnpmStub(directory);
    const logPath = join(directory, "commands.log");
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--input-type=module",
        "-e",
        `const { default: setup } = await import(${JSON.stringify(prepareUrl)}); await setup()`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: directory,
          PREPARE_COMMAND_LOG: logPath,
          WEB_TEST_RUNTIME: "development",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(logPath, "utf8"), "--filter @repo/db build\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI invocation prepares the database before Playwright", () => {
  const directory = mkdtempSync(join(tmpdir(), "web-prepare-cli-"));
  try {
    createPnpmStub(directory);
    const logPath = join(directory, "commands.log");
    const result = spawnSync(
      process.execPath,
      ["--conditions=development", fileURLToPath(prepareUrl)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: directory,
          PREPARE_COMMAND_LOG: logPath,
          WEB_TEST_RUNTIME: "development",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(logPath, "utf8"), "--filter @repo/db build\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Help and tutorial video configs resolve the callable global setup", async () => {
  const repositoryRoot = new URL("../../../../", import.meta.url);
  const helpConfig = readFileSync(
    new URL(
      "tools/help-screenshots/playwright.screenshots.config.ts",
      repositoryRoot,
    ),
    "utf8",
  );
  const tutorialConfig = readFileSync(
    new URL(
      "tools/tutorial-video/playwright.recordings.config.ts",
      repositoryRoot,
    ),
    "utf8",
  );
  const resolvedSetup = import.meta.resolve("web/test-support/browser/prepare");
  const setup = await import(resolvedSetup);

  assert.match(
    helpConfig,
    /globalSetup: fileURLToPath\(\s*import\.meta\.resolve\("web\/test-support\/browser\/prepare"\)/u,
  );
  assert.match(
    tutorialConfig,
    /import\.meta\.resolve\("web\/test-support\/browser\/prepare"\)/u,
  );
  assert.equal(typeof setup.default, "function");
});

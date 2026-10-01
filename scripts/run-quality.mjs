import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const QUALITY_STAGES = [
  { name: "format:check", command: "format:check", phase: "early" },
  { name: "lint", command: "lint", phase: "early" },
  { name: "spellcheck", command: "spellcheck", phase: "early" },
  { name: "knip", command: "knip", phase: "early" },
  {
    name: "knip:production-exports",
    command: "knip:production-exports",
    phase: "early",
  },
  { name: "typecheck", command: "typecheck", phase: "early" },
  { name: "test:small", command: "test:small", phase: "early" },
  { name: "build", command: "build", phase: "build" },
  { name: "build:storybook", command: "build:storybook", phase: "build" },
  { name: "test:medium", command: "test:medium", phase: "medium" },
];

function executeCommand(command, { env } = {}) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, [command], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  return result.error || result.status !== 0 ? 1 : 0;
}

function printSummary(results, write) {
  write("\nQuality summary:");
  for (const result of results) {
    const detail = result.reason ? ` (${result.reason})` : "";
    write(`- ${result.name}: ${result.status}${detail}`);
  }
}

export function runQuality({
  runCommand = executeCommand,
  write = console.log,
  smallCommand = "test:small",
  mediumCommand = "test:medium",
  testEnv,
  smallEnv = testEnv,
  mediumEnv = testEnv,
  skippedStages = {},
} = {}) {
  const commands = QUALITY_STAGES.map(({ command }) => command);
  commands[6] = smallCommand;
  commands[9] = mediumCommand;

  const results = QUALITY_STAGES.map(({ name }) => ({
    name,
    status: "SKIP",
    reason: "前段階の失敗により未実行",
  }));

  let earlyFailed = false;
  for (let index = 0; index < 7; index += 1) {
    const stage = QUALITY_STAGES[index];
    if (skippedStages[stage.name]) {
      results[index] = {
        name: stage.name,
        status: "SKIP",
        reason: skippedStages[stage.name],
      };
      continue;
    }
    const exitCode =
      index === 6 && smallEnv
        ? runCommand(commands[index], { env: smallEnv })
        : runCommand(commands[index]);
    results[index] = {
      name: stage.name,
      status: exitCode === 0 ? "PASS" : "FAIL",
    };
    if (exitCode !== 0) earlyFailed = true;
  }

  let buildFailed = false;
  for (let index = 7; index <= 8; index += 1) {
    const stage = QUALITY_STAGES[index];
    if (skippedStages[stage.name]) {
      results[index] = {
        name: stage.name,
        status: "SKIP",
        reason: skippedStages[stage.name],
      };
    } else if (earlyFailed) {
      results[index].reason = "早期診断チェックの失敗により未実行";
    } else {
      const exitCode = runCommand(commands[index]);
      results[index] = {
        name: stage.name,
        status: exitCode === 0 ? "PASS" : "FAIL",
      };
      if (exitCode !== 0) buildFailed = true;
    }
  }

  const mediumIndex = 9;
  const mediumStage = QUALITY_STAGES[mediumIndex];
  if (skippedStages[mediumStage.name]) {
    results[mediumIndex] = {
      name: mediumStage.name,
      status: "SKIP",
      reason: skippedStages[mediumStage.name],
    };
  } else if (earlyFailed) {
    results[mediumIndex].reason = "早期診断チェックの失敗により未実行";
  } else if (buildFailed) {
    results[mediumIndex].reason =
      "build または build:storybook の失敗により未実行";
  } else {
    const mediumExitCode = mediumEnv
      ? runCommand(commands[mediumIndex], { env: mediumEnv })
      : runCommand(commands[mediumIndex]);
    results[mediumIndex] = {
      name: mediumStage.name,
      status: mediumExitCode === 0 ? "PASS" : "FAIL",
    };
  }

  printSummary(results, write);
  return {
    exitCode: results.some((result) => result.status === "FAIL") ? 1 : 0,
    results,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runQuality().exitCode;
}

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUALITY_TEST_ENV } from "./test-environment.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const QUALITY_HELP_ENV = QUALITY_TEST_ENV;

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
  { name: "typecheck", command: "typecheck", phase: "early", env: "help" },
  {
    name: "test:small",
    command: "test:small",
    phase: "early",
    commandOption: "smallCommand",
    env: "smallTest",
  },
  { name: "build", command: "build", phase: "build", env: "help" },
  { name: "build:storybook", command: "build:storybook", phase: "build" },
  {
    name: "test:medium",
    command: "test:medium",
    phase: "medium",
    commandOption: "mediumCommand",
    env: "mediumTest",
    blockedBy: ["early", "build"],
  },
];

const PHASE_SKIP_REASONS = {
  early: "早期診断チェックの失敗により未実行",
  build: "早期診断チェックの失敗により未実行",
  medium: {
    early: "早期診断チェックの失敗により未実行",
    build: "build または build:storybook の失敗により未実行",
  },
};

function executeCommand(command, { env } = {}) {
  if (command.startsWith("node scripts/quality/")) {
    const result = spawnSync(process.execPath, command.split(" ").slice(1), {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    return result.error || result.status !== 0 ? 1 : 0;
  }
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
  const commandOptions = { smallCommand, mediumCommand };

  const results = QUALITY_STAGES.map(({ name }) => ({
    name,
    status: "SKIP",
    reason: "前段階の失敗により未実行",
  }));

  const phases = [...new Set(QUALITY_STAGES.map(({ phase }) => phase))];
  const failedPhases = new Set();
  const indexesByPhase = new Map(
    phases.map((phase) => [
      phase,
      QUALITY_STAGES.flatMap((stage, index) =>
        stage.phase === phase ? [index] : [],
      ),
    ]),
  );

  for (const phase of phases) {
    const indexes = indexesByPhase.get(phase);
    for (const index of indexes) {
      const stage = QUALITY_STAGES[index];
      const failedDependency = stage.blockedBy?.find((dependency) =>
        failedPhases.has(dependency),
      );
      if (skippedStages[stage.name]) {
        results[index] = {
          name: stage.name,
          status: "SKIP",
          reason: skippedStages[stage.name],
        };
        continue;
      }
      if (failedDependency) {
        results[index].reason = PHASE_SKIP_REASONS[phase][failedDependency];
        continue;
      }
      const failedPriorPhase =
        phase !== "early" &&
        phases
          .slice(0, phases.indexOf(phase))
          .find((prior) => failedPhases.has(prior));
      if (failedPriorPhase) {
        results[index].reason = PHASE_SKIP_REASONS[phase];
        continue;
      }

      const command = stage.commandOption
        ? commandOptions[stage.commandOption]
        : stage.command;
      const env =
        stage.env === "help"
          ? QUALITY_HELP_ENV
          : stage.env === "smallTest"
            ? { ...QUALITY_HELP_ENV, ...smallEnv }
            : stage.env === "mediumTest"
              ? { ...QUALITY_HELP_ENV, ...mediumEnv }
              : undefined;
      const exitCode = env ? runCommand(command, { env }) : runCommand(command);
      results[index] = {
        name: stage.name,
        status: exitCode === 0 ? "PASS" : "FAIL",
      };
      if (exitCode !== 0) failedPhases.add(phase);
    }
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

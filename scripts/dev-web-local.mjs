import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CERTIFICATE_FILES = ["localhost.pem", "localhost-key.pem"];
const REQUIRED_ENVIRONMENT = [
  "DATABASE_URL",
  "DATABASE_ENVIRONMENT",
  "LINE_CHANNEL_ID",
  "NEXT_PUBLIC_LIFF_ID",
];
const LOCAL_PORTS = [3000];

export function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function validateConfig(environment, existingFiles = []) {
  const missing = REQUIRED_ENVIRONMENT.filter(
    (key) => !environment[key] || environment[key].trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `.env.localに必要な環境変数がありません: ${missing.join(", ")}`,
    );
  }
  if (environment.DATABASE_ENVIRONMENT !== "local") {
    throw new Error("DATABASE_ENVIRONMENTはlocalである必要があります。");
  }
  const files = new Set(existingFiles);
  const missingCertificates = CERTIFICATE_FILES.filter(
    (file) => !files.has(file),
  );
  if (missingCertificates.length > 0) {
    throw new Error(
      `rootに証明書がありません: ${missingCertificates.join(", ")}`,
    );
  }
  return {
    ...environment,
    DATABASE_ENVIRONMENT: "local",
  };
}

export function buildCommands(root = ROOT) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return [
    {
      name: "db migration",
      command: pnpm,
      args: ["--filter", "@repo/db", "migrate"],
    },
    {
      name: "web",
      command: pnpm,
      args: [
        "--filter",
        "web",
        "exec",
        "next",
        "dev",
        "--webpack",
        "--port",
        "3000",
        "--experimental-https",
        "--experimental-https-key",
        path.resolve(root, "localhost-key.pem"),
        "--experimental-https-cert",
        path.resolve(root, "localhost.pem"),
      ],
    },
  ];
}

export function checkPortAvailability(port, createNetServer = createServer) {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen({ host: "localhost", port }, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

export async function ensureLocalPortsAvailable(
  checkPort = checkPortAvailability,
) {
  for (const port of LOCAL_PORTS) {
    try {
      await checkPort(port);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EADDRINUSE") {
        throw new Error(`localhost:${port} は既に使用されています。`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `localhost:${port} の利用可否を確認できません: ${detail}`,
      );
    }
  }
}

async function readConfig(root = ROOT) {
  const envFile = await readFile(path.join(root, ".env.local"), "utf8");
  const files = [];
  for (const file of CERTIFICATE_FILES) {
    await access(path.join(root, file), constants.R_OK);
    files.push(file);
  }
  // The root file is the source of truth for the launch configuration. Do not
  // let an inherited production value satisfy a missing local setting.
  return validateConfig(parseEnvFile(envFile), files);
}

function start(command, environment, root = ROOT) {
  return spawn(command.command, command.args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
}

function stopChildren(children, signal) {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

function waitForClose(child) {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function run() {
  let environment;
  try {
    environment = await readConfig();
    await ensureLocalPortsAvailable();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  const commands = buildCommands();
  const children = [];
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    stopChildren(children, signal);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const migration = start(commands[0], environment);
  children.push(migration);
  const migrationCode = await waitForClose(migration);
  if (migrationCode.code !== 0 || migrationCode.signal !== null) {
    if (!shuttingDown) process.exitCode = migrationCode.code ?? 1;
    return;
  }

  children.length = 0;
  children.push(start(commands[1], environment));

  const monitor = (child) => {
    child.once("close", (code, signal) => {
      if (!shuttingDown && (code !== 0 || signal !== null)) {
        shutdown("SIGTERM");
      }
    });
  };
  children.forEach(monitor);
  const result = await Promise.race(children.map(waitForClose));
  if (!shuttingDown) {
    // A dev server exiting normally is also a reason to stop this launcher;
    // otherwise the remaining servers would be left behind.
    process.exitCode = result.code ?? 1;
    stopChildren(children, "SIGTERM");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();

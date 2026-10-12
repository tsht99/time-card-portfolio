import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { QUALITY_TEST_ENV } from "./test-environment.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("Help build keeps dependency builds scoped to the Help workspace", () => {
  const turboConfig = JSON.parse(
    readFileSync(path.join(root, "turbo.json"), "utf8"),
  );

  assert.ok(turboConfig.tasks["help#build"].dependsOn.includes("^build"));

  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    pnpm,
    ["exec", "turbo", "run", "build", "--filter=help", "--dry=json"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...QUALITY_TEST_ENV },
    },
  );

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);

  const graph = JSON.parse(result.stdout);
  const taskIds = graph.tasks.map(({ taskId }) => taskId).sort();

  assert.deepEqual(
    taskIds,
    ["help#build"],
    "Help test URLs must not hide unrelated build tasks in the Help graph",
  );
});

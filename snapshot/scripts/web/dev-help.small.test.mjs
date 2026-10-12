import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHelpDevLaunch } from "./dev-help.mjs";

test("dev:help launcher passes the generated screenshot base to its child", () => {
  const launch = buildHelpDevLaunch({
    PATH: "test",
    HELP_VIDEO_BASE: "https://example.test/videos",
  });
  assert.deepEqual(launch.args, ["--filter", "help", "dev"]);
  assert.equal(launch.env.HELP_SCREENSHOT_BASE, "/images/generated");
  assert.equal(launch.env.HELP_VIDEO_BASE, "https://example.test/videos");
  assert.equal(launch.command, "pnpm");
  assert.equal(launch.shell, false);
});

test("dev:help launcher runs pnpm.cmd through a Windows shell", () => {
  const launch = buildHelpDevLaunch({ PATH: "test" }, "win32");
  assert.equal(launch.command, "pnpm.cmd");
  assert.equal(launch.shell, true);
  assert.deepEqual(launch.args, ["--filter", "help", "dev"]);
  assert.equal(launch.env.HELP_SCREENSHOT_BASE, "/images/generated");
});

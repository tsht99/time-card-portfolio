import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page, TestType } from "@playwright/test";
import {
  type HelpScreenshotScenario,
  registerHelpScreenshotScenario,
} from "./help-screenshot.ts";

test("scenario fixture options remain scoped to their own describe", () => {
  const captured: Array<Record<string, unknown>> = [];
  let currentOptions: Record<string, unknown> | undefined;
  const fakeTest = {
    describe(_title: string, callback: () => void) {
      currentOptions = {};
      callback();
      captured.push(currentOptions);
      currentOptions = undefined;
    },
    use(options: unknown) {
      if (!currentOptions) throw new Error("test.use must run inside describe");
      Object.assign(currentOptions, options);
    },
  } as unknown as Pick<TestType<object, object>, "use" | "describe">;
  const makeScenario = (
    id: string,
    fixedNow: string,
  ): HelpScreenshotScenario => ({
    id,
    screenshotId: id,
    route: "/clock",
    role: "staff",
    fixedNow,
    viewport: { width: 430, height: 932 },
    browserZoom: 1,
    deviceScaleFactor: 1,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    chromiumLanguage: "ja-JP",
    output: `${id}.png`,
    fixtureOptions: { staffFixedNow: fixedNow },
    register() {},
    async assertReady() {},
  });

  registerHelpScreenshotScenario(
    makeScenario("first", "2026-01-01T03:00:00.000Z"),
    fakeTest,
    "/repo/tools/help-screenshots/test-support",
  );
  registerHelpScreenshotScenario(
    makeScenario("second", "2026-01-01T09:00:00.000Z"),
    fakeTest,
    "/repo/tools/help-screenshots/test-support",
  );

  assert.deepEqual(
    captured.map((options) => options.staffFixedNow),
    ["2026-01-01T03:00:00.000Z", "2026-01-01T09:00:00.000Z"],
  );
});

test("executor reloads the prepared route, restores volatile state, then validates and captures", async () => {
  let registeredCapture:
    | ((page: Page, fixtures: Record<string, unknown>) => Promise<void>)
    | undefined;
  let options: Record<string, unknown> | undefined;
  let outputDirectory: string | undefined;
  let insideDescribe = false;
  let currentUrl = "";
  const events: string[] = [];
  const testDirectory = "/repo/tools/help-screenshots/test-support";
  const expectedOutputPath =
    "/repo/apps/help/public/images/generated/admin-example.png";
  const scenario: HelpScreenshotScenario = {
    id: "admin-example",
    screenshotId: "admin-example",
    route: "/admin",
    role: "admin",
    fixedNow: "2026-01-01T03:00:00.000Z",
    viewport: { width: 430, height: 932 },
    browserZoom: 1,
    deviceScaleFactor: 1,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    chromiumLanguage: "ja-JP",
    output: "../../../apps/help/public/images/generated/admin-example.png",
    fixtureOptions: { adminDisplayName: "管理者" },
    register(capture) {
      assert.equal(insideDescribe, true);
      registeredCapture = capture;
    },
    async prepare(page) {
      await page.goto("/admin/users/staff-id");
      events.push(`prepare:${currentUrl}`);
    },
    async restoreAfterReload() {
      events.push(`restore:${currentUrl}`);
    },
    async assertReady(_page, fixtures) {
      assert.ok("admin" in fixtures);
      events.push(`assert:${currentUrl}`);
    },
  };
  const page = {
    context: () => ({ newCDPSession: async () => ({ send: async () => {} }) }),
    goto: async (route: string) => {
      currentUrl = route;
      events.push(`goto:${route}`);
      if (route === "/admin") assert.equal(route, "/admin");
    },
    reload: async () => {
      events.push(`reload:${currentUrl}`);
    },
    evaluate: async () => ({ pageScale: 1, deviceScaleFactor: 1 }),
    screenshot: async (input: unknown) => {
      events.push(`screenshot:${(input as { path: string }).path}`);
      assert.deepEqual(input, {
        path: expectedOutputPath,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
    },
  };
  const fakeTest = {
    use(input: unknown) {
      options = input as Record<string, unknown>;
    },
    describe(_title: string, callback: () => void) {
      insideDescribe = true;
      callback();
      insideDescribe = false;
    },
  } as unknown as Pick<TestType<object, object>, "use" | "describe">;

  registerHelpScreenshotScenario(
    scenario,
    fakeTest,
    testDirectory,
    async (directory) => {
      outputDirectory = directory;
    },
  );
  assert.ok(registeredCapture);
  assert.deepEqual(options?.viewport, scenario.viewport);
  assert.deepEqual(options?.adminDisplayName, "管理者");
  await registeredCapture(page as unknown as Page, { admin: {} });
  assert.equal(outputDirectory, "/repo/apps/help/public/images/generated");
  assert.deepEqual(events, [
    "goto:/admin",
    "goto:/admin/users/staff-id",
    "prepare:/admin/users/staff-id",
    "reload:/admin/users/staff-id",
    "restore:/admin/users/staff-id",
    "assert:/admin/users/staff-id",
    `screenshot:${expectedOutputPath}`,
  ]);
});

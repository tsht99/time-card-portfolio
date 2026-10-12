import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, TestType } from "@playwright/test";

const helpScreenshotDirectory = fileURLToPath(new URL(".", import.meta.url));

export type HelpScreenshotScenario = {
  id: string;
  screenshotId: string;
  route: string;
  role: string;
  displayName?: string;
  inputTime?: string;
  workPeriod?: "day" | "night";
  fixedNow?: string;
  viewport: { width: number; height: number };
  browserZoom: number;
  deviceScaleFactor: number;
  locale: string;
  timezoneId: string;
  chromiumLanguage: string;
  output: string;
  fixtureOptions?: Record<string, unknown>;
  register: (
    capture: (page: Page, fixtures: Record<string, unknown>) => Promise<void>,
  ) => void;
  prepare?: (page: Page, fixtures: Record<string, unknown>) => Promise<void>;
  restoreAfterReload?: (
    page: Page,
    fixtures: Record<string, unknown>,
  ) => Promise<void>;
  assertReady: (page: Page, fixtures: Record<string, unknown>) => Promise<void>;
};

function resolveHelpScreenshotOutput(
  scenario: Pick<HelpScreenshotScenario, "output">,
  directory = helpScreenshotDirectory,
): string {
  return resolve(directory, scenario.output);
}

/** Register a scenario with its own auth fixture and page-state contract. */
export function registerHelpScreenshotScenario(
  scenario: HelpScreenshotScenario,
  test: Pick<TestType<object, object>, "use" | "describe">,
  directory = helpScreenshotDirectory,
  ensureOutputDirectory: (directory: string) => Promise<void> = async (
    directory,
  ) => {
    await mkdir(directory, { recursive: true });
  },
) {
  const outputPath = resolveHelpScreenshotOutput(scenario, directory);
  test.describe(`help screenshot ${scenario.id}`, () => {
    test.use({
      ...scenario.fixtureOptions,
      locale: scenario.locale,
      timezoneId: scenario.timezoneId,
      viewport: scenario.viewport,
      deviceScaleFactor: scenario.deviceScaleFactor,
    });

    scenario.register(async (page, fixtures) => {
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.setPageScaleFactor", {
        pageScaleFactor: scenario.browserZoom,
      });
      await page.goto(scenario.route);
      await scenario.prepare?.(page, fixtures);
      await page.reload();
      await scenario.restoreAfterReload?.(page, fixtures);
      await scenario.assertReady(page, fixtures);

      const browserScale = await page.evaluate(() => ({
        pageScale: window.visualViewport?.scale,
        deviceScaleFactor: window.devicePixelRatio,
      }));
      if (browserScale.pageScale !== scenario.browserZoom) {
        throw new Error(`Unexpected browser zoom for ${scenario.id}`);
      }
      if (browserScale.deviceScaleFactor !== scenario.deviceScaleFactor) {
        throw new Error(`Unexpected device scale factor for ${scenario.id}`);
      }
      await ensureOutputDirectory(dirname(outputPath));
      await page.screenshot({
        path: outputPath,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
    });
  });
}

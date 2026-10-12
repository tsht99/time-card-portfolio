import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function assertAdminRouteReadiness(
  page: Page,
  previousRouteDataToken?: string,
) {
  const diagnostic = page.getByTestId("admin-route-readiness-diagnostic");
  if (previousRouteDataToken !== undefined) {
    await expect
      .poll(() => diagnostic.getAttribute("data-route-data-token"))
      .not.toBe(previousRouteDataToken);
  }
  await expect(diagnostic).toHaveAttribute("data-reported", "true");
  await expect(diagnostic).toHaveAttribute("data-ready", "true");
  const values = {
    providerRenderId: await diagnostic.getAttribute("data-provider-render-id"),
    routeDataToken: await diagnostic.getAttribute("data-route-data-token"),
    routeLocation: await diagnostic.getAttribute("data-route-location"),
    reportedRouteLocation: await diagnostic.getAttribute(
      "data-reported-route-location",
    ),
  };
  expect(values.providerRenderId).toBeTruthy();
  expect(values.routeDataToken).toBeTruthy();
  expect(values.providerRenderId).not.toBe(values.routeDataToken);
  console.info(`[admin route readiness] ${JSON.stringify(values)}`);
  return values;
}

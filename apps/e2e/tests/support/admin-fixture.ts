import { randomUUID } from "node:crypto";

import { test as base, expect } from "@playwright/test";

import { setE2eBrowserReferenceTime } from "../../reference-time";
import { createAuthenticatedUser } from "./authenticated-user-fixture";

type AdminFixture = {
  displayName: string;
  userId: string;
};

export const test = base.extend<{ admin: AdminFixture }>({
  admin: async ({ page }, use) => {
    const displayName = `E2E管理者-${randomUUID()}`;
    const fixture = await createAuthenticatedUser({
      displayName,
      role: "admin",
      status: "active",
    });
    try {
      await fixture.setSessionCookie(page.context());
      await setE2eBrowserReferenceTime(page);
      await use({ ...fixture, displayName });
    } finally {
      await fixture.cleanup();
    }
  },
});

export { expect };

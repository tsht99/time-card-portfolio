import { randomUUID } from "node:crypto";

import { test as base, expect } from "@playwright/test";
import { createAuthenticatedUser } from "./authenticated-user-fixture.ts";
import { setTestBrowserReferenceTime } from "./reference-time.ts";

type AdminFixture = {
  displayName: string;
  userId: string;
};

type AdminFixtureOptions = {
  adminDisplayName: string | undefined;
  adminUserId: string | undefined;
};

export const test = base.extend<AdminFixtureOptions & { admin: AdminFixture }>({
  adminDisplayName: [undefined, { option: true }],
  adminUserId: [undefined, { option: true }],
  admin: async ({ page, adminDisplayName, adminUserId }, use) => {
    const displayName = adminDisplayName ?? `E2E管理者-${randomUUID()}`;
    const fixture = await createAuthenticatedUser({
      displayName,
      role: "admin",
      status: "active",
      userId: adminUserId,
    });
    try {
      await fixture.setSessionCookie(page.context());
      await setTestBrowserReferenceTime(page);
      // Playwright names its fixture continuation `use`; this is not a React hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use({ ...fixture, displayName });
    } finally {
      await fixture.cleanup();
    }
  },
});

export { expect };

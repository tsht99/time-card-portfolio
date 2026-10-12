import "server-only";

import { getDatabase } from "@repo/db";
import {
  createAdminUserReadApplication,
  createAuthenticationApplication,
  createUserManagementApplication,
} from "@repo/users";
import {
  createLineIdentityVerifier,
  createPostgresUsersAdapter,
} from "@repo/users/infrastructure";
import { createUserReferenceApplication } from "@repo/users/internal";
import { getLineChannelId, getSessionTtlHours } from "./runtime-env";

function createUsersAdapter() {
  return createPostgresUsersAdapter(getDatabase(), {
    sessionTtlHours: getSessionTtlHours(),
  });
}

export function createTimeCardAuthenticationApplication() {
  const adapter = createUsersAdapter();
  return createAuthenticationApplication({
    line: createLineIdentityVerifier(getLineChannelId()),
    users: adapter,
    sessions: adapter,
    unitOfWork: adapter,
  });
}

export function createTimeCardUserManagementApplication() {
  const adapter = createUsersAdapter();
  return createUserManagementApplication(adapter, adapter);
}

export function createTimeCardUserReadApplication() {
  return createUserReferenceApplication(createUsersAdapter());
}

export function createTimeCardAdminUserReadApplication() {
  const adapter = createUsersAdapter();
  return createAdminUserReadApplication(adapter);
}

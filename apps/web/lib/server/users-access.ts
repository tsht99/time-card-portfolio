import "server-only";

import { getDatabase } from "@repo/db";
import { getLineChannelId, getSessionTtlHours } from "@repo/server/env";
import {
  createAuthenticationApplication,
  createUserManagementApplication,
  createUserReadApplication,
} from "@repo/users";
import {
  createLineIdentityVerifier,
  createPostgresUsersAdapter,
} from "@repo/users/infrastructure";

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
  return createUserReadApplication(createUsersAdapter());
}

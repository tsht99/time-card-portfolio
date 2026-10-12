import { randomUUID } from "node:crypto";

// This token belongs to the route payload, independently of the admin
// template's authentication render token.
export function createAdminRouteDataToken() {
  return randomUUID();
}

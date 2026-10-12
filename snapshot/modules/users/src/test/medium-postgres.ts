import { startMediumTestDatabase as startDatabase } from "@repo/test-support/medium-postgres";
import * as schema from "../schema/index.ts";

export function startMediumTestDatabase() {
  return startDatabase({ schema });
}

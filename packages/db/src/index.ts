export { normalizePostgresConnectionString } from "@repo/platform";
export { getDatabase } from "./database.ts";
export {
  assertConnectedMaintenanceDatabase,
  type MaintenanceConnection,
  resolveMaintenanceConnection,
} from "./maintenance-connection.ts";
export * from "./schema/index.ts";

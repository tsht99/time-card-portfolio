import { PostgresAttendanceCurrentStateProjectionRebuilder } from "@repo/attendance/infrastructure";
import { assertConnectedMaintenanceDatabase } from "@repo/db";
import { Pool, type PoolClient } from "pg";
import { resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection } from "../maintenance/attendance-current-state-projection-rebuild-environment.ts";
import { formatAttendanceCurrentStateProjectionRebuildFailure } from "./rebuild-attendance-current-state-projection-error-output.ts";

async function main(): Promise<void> {
  const maintenanceConnection =
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      process.argv[2],
      process.env,
    );

  const pool = new Pool({
    connectionString: maintenanceConnection.connectionString,
  });
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await assertConnectedMaintenanceDatabase(
      client,
      maintenanceConnection.identity,
    );
    const result = await new PostgresAttendanceCurrentStateProjectionRebuilder(
      client,
    ).rebuild();
    console.log(
      `Rebuilt Attendance Current State Projection: ${result.currentStateCount} current states.`,
    );
  } finally {
    try {
      client?.release();
    } finally {
      await pool.end();
    }
  }
}

void main().catch((error) => {
  console.error(formatAttendanceCurrentStateProjectionRebuildFailure(error));
  process.exitCode = 1;
});

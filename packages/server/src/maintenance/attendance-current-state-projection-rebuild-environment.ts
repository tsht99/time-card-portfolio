import {
  type MaintenanceConnection,
  resolveMaintenanceConnection,
} from "@repo/db";

const attendanceCurrentStateProjectionRebuildModes = [
  "local",
  "preview",
  "production",
] as const;

type AttendanceCurrentStateProjectionRebuildMode =
  (typeof attendanceCurrentStateProjectionRebuildModes)[number];

type RebuildEnvironment = Readonly<Record<string, string | undefined>>;

const vercelEnvironmentMarkers = [
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
] as const;

function isRebuildMode(
  mode: string,
): mode is AttendanceCurrentStateProjectionRebuildMode {
  return attendanceCurrentStateProjectionRebuildModes.includes(
    mode as AttendanceCurrentStateProjectionRebuildMode,
  );
}

/**
 * Rejects rebuild invocations outside their explicitly selected maintenance
 * environment. This intentionally does not use the application runtime env
 * schema: the confirmation value is only for this one-off operator command.
 */
function assertAttendanceCurrentStateProjectionRebuildEnvironment(
  mode: string | undefined,
  environment: RebuildEnvironment,
): AttendanceCurrentStateProjectionRebuildMode {
  if (!mode || !isRebuildMode(mode)) {
    throw new Error(
      "Attendance Current State Projection rebuild mode must be local, preview, or production.",
    );
  }

  if (
    vercelEnvironmentMarkers.some((marker) => environment[marker] !== undefined)
  ) {
    throw new Error(
      "Attendance Current State Projection rebuild cannot run in a Vercel environment.",
    );
  }

  if (environment.DATABASE_ENVIRONMENT !== mode) {
    throw new Error(
      "DATABASE_ENVIRONMENT must match the Attendance Current State Projection rebuild mode.",
    );
  }

  if (
    mode === "preview" &&
    environment.ATTENDANCE_PROJECTION_REBUILD_CONFIRM !== "preview"
  ) {
    throw new Error(
      "Preview Attendance Current State Projection rebuild requires explicit confirmation.",
    );
  }

  if (
    mode === "production" &&
    environment.ATTENDANCE_PROJECTION_REBUILD_CONFIRM !== "production"
  ) {
    throw new Error(
      "Production Attendance Current State Projection rebuild requires explicit confirmation.",
    );
  }

  return mode;
}

export function resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
  mode: string | undefined,
  environment: RebuildEnvironment,
): MaintenanceConnection {
  const validatedMode =
    assertAttendanceCurrentStateProjectionRebuildEnvironment(mode, environment);
  return resolveMaintenanceConnection(validatedMode, environment);
}

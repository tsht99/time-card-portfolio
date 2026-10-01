import assert from "node:assert/strict";
import test from "node:test";
import { resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection } from "./attendance-current-state-projection-rebuild-environment.ts";

// cspell:ignore UNPOOLED pooler

const directUrl =
  "postgresql://maintenance:secret@ep-example.us-east-1.aws.neon.tech/timecard";
const expectedMaintenanceEnvironment = {
  DATABASE_MAINTENANCE_EXPECTED_HOST: "ep-example.us-east-1.aws.neon.tech",
  DATABASE_MAINTENANCE_EXPECTED_DATABASE: "timecard",
};

function createConfirmedMaintenanceEnvironment(
  mode: "preview" | "production",
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_ENVIRONMENT: mode,
    ATTENDANCE_PROJECTION_REBUILD_CONFIRM: mode,
    DATABASE_URL: "postgresql://pooled.example.test/wrong_database",
    DATABASE_URL_UNPOOLED: directUrl,
    ...expectedMaintenanceEnvironment,
    ...overrides,
  };
}

test("local rebuildはlocal DATABASE_ENVIRONMENTだけを許可する", () => {
  assert.equal(
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "local",
      { DATABASE_ENVIRONMENT: "local", DATABASE_URL: directUrl },
    ).connectionString,
    directUrl,
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "local",
      { DATABASE_ENVIRONMENT: "preview", DATABASE_URL: directUrl },
    ),
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "local",
      { DATABASE_ENVIRONMENT: "production", DATABASE_URL: directUrl },
    ),
  );
});

test("preview rebuildはpreview環境と明示確認を要求する", () => {
  assert.equal(
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "preview",
      createConfirmedMaintenanceEnvironment("preview"),
    ).connectionString,
    directUrl,
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "preview",
      createConfirmedMaintenanceEnvironment("preview", {
        ATTENDANCE_PROJECTION_REBUILD_CONFIRM: undefined,
      }),
    ),
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "preview",
      createConfirmedMaintenanceEnvironment("preview", {
        DATABASE_ENVIRONMENT: "local",
      }),
    ),
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "preview",
      createConfirmedMaintenanceEnvironment("preview", {
        DATABASE_ENVIRONMENT: "production",
      }),
    ),
  );
});

test("production rebuildはproduction環境と明示確認を要求する", () => {
  assert.equal(
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "production",
      createConfirmedMaintenanceEnvironment("production"),
    ).connectionString,
    directUrl,
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "production",
      createConfirmedMaintenanceEnvironment("production", {
        ATTENDANCE_PROJECTION_REBUILD_CONFIRM: undefined,
      }),
    ),
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "production",
      createConfirmedMaintenanceEnvironment("production", {
        ATTENDANCE_PROJECTION_REBUILD_CONFIRM: "preview",
      }),
    ),
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "production",
      createConfirmedMaintenanceEnvironment("production", {
        DATABASE_ENVIRONMENT: "preview",
      }),
    ),
  );
});

test("Vercel markerと未対応modeを拒否する", () => {
  for (const mode of ["local", "preview", "production"] as const) {
    for (const marker of ["VERCEL", "VERCEL_ENV", "VERCEL_GIT_COMMIT_REF"]) {
      assert.throws(() =>
        resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
          mode,
          mode === "local"
            ? {
                DATABASE_ENVIRONMENT: mode,
                DATABASE_URL: directUrl,
                [marker]: "1",
              }
            : { ...createConfirmedMaintenanceEnvironment(mode), [marker]: "1" },
        ),
      );
    }
  }
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "production",
      createConfirmedMaintenanceEnvironment("production", {
        ATTENDANCE_PROJECTION_REBUILD_CONFIRM: undefined,
      }),
    ),
  );
  assert.throws(() =>
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      undefined,
      { DATABASE_ENVIRONMENT: "local", DATABASE_URL: directUrl },
    ),
  );
});

test("local rebuildはenvironment guard後にDATABASE_URLからmaintenance接続を解決する", () => {
  const result =
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "local",
      {
        DATABASE_ENVIRONMENT: "local",
        DATABASE_URL: directUrl,
      },
    );

  assert.equal(result.connectionString, directUrl);
  assert.deepEqual(result.identity, {
    host: "ep-example.us-east-1.aws.neon.tech",
    database: "timecard",
  });
  assert.deepEqual(
    resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
      "local",
      {
        DATABASE_ENVIRONMENT: "local",
        DATABASE_URL: directUrl,
        DATABASE_MAINTENANCE_EXPECTED_HOST: "another.example.test",
        DATABASE_MAINTENANCE_EXPECTED_DATABASE: "another_database",
      },
    ),
    result,
  );
});

test("previewとproduction rebuildはconfirmation後にDATABASE_URL_UNPOOLEDだけを利用する", () => {
  for (const mode of ["preview", "production"] as const) {
    const result =
      resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
        mode,
        createConfirmedMaintenanceEnvironment(mode),
      );

    assert.equal(result.connectionString, directUrl);
  }
});

test("previewとproduction rebuildはDATABASE_URL_UNPOOLEDが無ければ接続前に拒否する", () => {
  for (const mode of ["preview", "production"] as const) {
    assert.throws(
      () =>
        resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
          mode,
          createConfirmedMaintenanceEnvironment(mode, {
            DATABASE_URL_UNPOOLED: undefined,
          }),
        ),
      /DATABASE_URL_UNPOOLED is not set/,
    );
  }
});

test("previewとproduction rebuildは共通maintenance guardのidentity検証を利用する", () => {
  assert.throws(
    () =>
      resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
        "preview",
        createConfirmedMaintenanceEnvironment("preview", {
          DATABASE_MAINTENANCE_EXPECTED_HOST: "another.example.test",
        }),
      ),
    /hostname does not match/,
  );
  assert.throws(
    () =>
      resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
        "production",
        createConfirmedMaintenanceEnvironment("production", {
          DATABASE_MAINTENANCE_EXPECTED_DATABASE: "another_database",
        }),
      ),
    /database name does not match/,
  );
  assert.throws(
    () =>
      resolveAttendanceCurrentStateProjectionRebuildMaintenanceConnection(
        "preview",
        createConfirmedMaintenanceEnvironment("preview", {
          DATABASE_URL_UNPOOLED:
            "postgresql://maintenance:secret@ep-example-pooler.us-east-1.aws.neon.tech/timecard",
        }),
      ),
    /must use a direct Neon hostname/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAttendanceCurrentStateReadModel } from "@repo/attendance/infrastructure";
import { attendanceCurrentStateProjectionMetadata, users } from "@repo/db";
import type { PostgresDatabase } from "@repo/platform";
import { startMediumTestDatabase } from "../test/medium-postgres.ts";

const firstUserId = "11111111-1111-4111-8111-111111111111";
const secondUserId = "11111111-1111-4111-8111-111111111112";
const attendanceCurrentStateProjectionName = "attendance-current-state-v2";
type AttendanceCurrentStateQueryResult = Awaited<
  ReturnType<PostgresAttendanceCurrentStateReadModel["query"]>
>;

function state(
  attendanceId: string,
  values: {
    userId: string;
    attendanceDate: string;
    workPeriod: "day" | "night";
    clockOutAt?: Date | null;
    eventVersion: number;
    isCancelled?: boolean;
  },
) {
  return {
    attendanceId,
    ...values,
    clockInAt: new Date(`${values.attendanceDate}T00:00:00.000Z`),
    clockOutAt: values.clockOutAt ?? null,
    isCancelled: values.isCancelled ?? false,
  };
}

function readyStates(result: AttendanceCurrentStateQueryResult) {
  assert.equal(result.kind, "ready");
  return result.states;
}

async function withMediumDatabase(
  operation: (input: {
    db: PostgresDatabase;
    readModel: PostgresAttendanceCurrentStateReadModel;
  }) => Promise<void>,
) {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values([
      { id: firstUserId, lineUserId: "current-state-first-user" },
      { id: secondUserId, lineUserId: "current-state-second-user" },
    ]);
    await operation({
      db: database.db,
      readModel: new PostgresAttendanceCurrentStateReadModel(database.db),
    });
  } finally {
    await database.close();
  }
}

test("fresh migration creates the attendance current-state projection schema", async () => {
  const database = await startMediumTestDatabase();
  try {
    assert.deepEqual(
      (
        await database.pool.query(
          `select to_regclass('public.attendance_current_states') as current_states,
                  to_regclass('public.attendance_current_state_projection_metadata') as metadata`,
        )
      ).rows,
      [
        {
          current_states: "attendance_current_states",
          metadata: "attendance_current_state_projection_metadata",
        },
      ],
    );
    assert.deepEqual(
      (
        await database.pool.query(
          `select column_name, is_nullable
             from information_schema.columns
            where table_schema = 'public'
              and table_name = 'attendance_current_states'
            order by ordinal_position`,
        )
      ).rows,
      [
        { column_name: "attendance_id", is_nullable: "NO" },
        { column_name: "user_id", is_nullable: "NO" },
        { column_name: "attendance_date", is_nullable: "NO" },
        { column_name: "work_period", is_nullable: "NO" },
        { column_name: "clock_in_at", is_nullable: "NO" },
        { column_name: "clock_out_at", is_nullable: "YES" },
        { column_name: "event_version", is_nullable: "NO" },
        { column_name: "is_cancelled", is_nullable: "NO" },
      ],
    );
  } finally {
    await database.close();
  }
});

test("current-state projectionの必須列はNULLを拒否しnullable列はNULLを保持する", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values({
      id: firstUserId,
      lineUserId: "current-state-null-boundary-user",
    });
    const baseValues = {
      attendance_id: "77777777-7777-4777-8777-777777777777",
      user_id: firstUserId,
      attendance_date: "2026-08-22",
      work_period: "day",
      clock_in_at: new Date("2026-08-22T09:00:00.000Z"),
      clock_out_at: null,
      event_version: 1,
    };
    const insertProjection = (overrides: Record<string, unknown> = {}) => {
      const values = { ...baseValues, ...overrides };
      const columns = Object.keys(values);
      return database.pool.query(
        `insert into attendance_current_states (${columns.map((column) => `"${column}"`).join(", ")})
         values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
        Object.values(values),
      );
    };

    for (const [index, column] of [
      "user_id",
      "work_period",
      "attendance_date",
      "clock_in_at",
      "event_version",
    ].entries()) {
      await assert.rejects(
        insertProjection({
          attendance_id: `77777777-7777-4777-8777-77777777777${index + 1}`,
          [column]: null,
        }),
        /null value in column/,
      );
    }

    await insertProjection({
      attendance_id: "77777777-7777-4777-8777-777777777778",
      clock_out_at: null,
    });
    assert.deepEqual(
      (
        await database.pool.query(
          `select attendance_date::text as attendance_date, clock_in_at, clock_out_at
             from attendance_current_states
            where attendance_id = '77777777-7777-4777-8777-777777777778'`,
        )
      ).rows,
      [
        {
          attendance_date: "2026-08-22",
          clock_in_at: new Date("2026-08-22T09:00:00.000Z"),
          clock_out_at: null,
        },
      ],
    );
  } finally {
    await database.close();
  }
});

test("current state can be persisted and queried once the projection is ready", async () => {
  await withMediumDatabase(async ({ db, readModel }) => {
    await readModel.upsert(
      state("22222222-2222-4222-8222-222222222222", {
        userId: firstUserId,
        attendanceDate: "2026-08-22",
        workPeriod: "day",
        clockOutAt: new Date("2026-08-22T09:00:00.000Z"),
        eventVersion: 2,
        isCancelled: false,
      }),
    );

    assert.deepEqual(await readModel.query({}), { kind: "not-ready" });

    await db.insert(attendanceCurrentStateProjectionMetadata).values({
      projectionName: attendanceCurrentStateProjectionName,
      isReady: true,
    });

    assert.deepEqual(readyStates(await readModel.query({})), [
      {
        attendanceId: "22222222-2222-4222-8222-222222222222",
        userId: firstUserId,
        attendanceDate: "2026-08-22",
        workPeriod: "day",
        clockInAt: new Date("2026-08-22T00:00:00.000Z"),
        clockOutAt: new Date("2026-08-22T09:00:00.000Z"),
        eventVersion: 2,
        isCancelled: false,
      },
    ]);
  });
});

test("legacy ready metadata does not certify the cancellation-aware projection", async () => {
  await withMediumDatabase(async ({ db, readModel }) => {
    await db.insert(attendanceCurrentStateProjectionMetadata).values({
      projectionName: "attendance-current-state",
      isReady: true,
    });
    assert.deepEqual(await readModel.query({}), { kind: "not-ready" });
  });
});

test("current-state query filters date, user, work period, and list statuses", async () => {
  await withMediumDatabase(async ({ db, readModel }) => {
    await Promise.all([
      readModel.upsert(
        state("22222222-2222-4222-8222-222222222222", {
          userId: firstUserId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockOutAt: new Date("2026-08-22T09:00:00.000Z"),
          eventVersion: 2,
        }),
      ),
      readModel.upsert(
        state("33333333-3333-4333-8333-333333333333", {
          userId: firstUserId,
          attendanceDate: "2026-08-23",
          workPeriod: "night",
          eventVersion: 1,
        }),
      ),
      readModel.upsert(
        state("44444444-4444-4444-8444-444444444444", {
          userId: firstUserId,
          attendanceDate: "2026-08-24",
          workPeriod: "day",
          clockOutAt: new Date("2026-08-24T09:00:00.000Z"),
          eventVersion: 2,
        }),
      ),
      readModel.upsert(
        state("55555555-5555-4555-8555-555555555555", {
          userId: secondUserId,
          attendanceDate: "2026-08-23",
          workPeriod: "day",
          clockOutAt: new Date("2026-08-23T09:00:00.000Z"),
          eventVersion: 2,
        }),
      ),
      readModel.upsert(
        state("66666666-6666-4666-8666-666666666666", {
          userId: firstUserId,
          attendanceDate: "2026-08-23",
          workPeriod: "day",
          eventVersion: 3,
          isCancelled: true,
        }),
      ),
    ]);
    await db.insert(attendanceCurrentStateProjectionMetadata).values({
      projectionName: attendanceCurrentStateProjectionName,
      isReady: true,
    });

    const attendanceIds = async (
      query: Parameters<typeof readModel.query>[0],
    ) =>
      readyStates(await readModel.query(query)).map(
        (currentState) => currentState.attendanceId,
      );

    assert.deepEqual(await attendanceIds({}), [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "55555555-5555-4555-8555-555555555555",
      "44444444-4444-4444-8444-444444444444",
    ]);
    assert.deepEqual(await attendanceIds({ includeCancelled: true }), [
      "66666666-6666-4666-8666-666666666666",
    ]);
    assert.deepEqual(
      await attendanceIds({
        startAttendanceDateInclusive: "2026-08-23",
        endAttendanceDateInclusive: "2026-08-24",
        userId: firstUserId,
        workPeriod: "day",
        includeCancelled: true,
      }),
      ["66666666-6666-4666-8666-666666666666"],
    );
    assert.deepEqual(
      await attendanceIds({
        startAttendanceDateInclusive: "2026-08-24",
        endAttendanceDateInclusive: "2026-08-24",
        includeCancelled: true,
      }),
      [],
    );
    assert.deepEqual(
      await attendanceIds({
        startAttendanceDateInclusive: "2026-08-22",
        endAttendanceDateInclusive: "2026-08-22",
        includeCancelled: true,
      }),
      [],
    );
    assert.deepEqual(
      await attendanceIds({
        startAttendanceDateInclusive: "2026-08-23",
        endAttendanceDateInclusive: "2026-08-23",
        userId: secondUserId,
        includeCancelled: true,
      }),
      [],
    );
    assert.deepEqual(
      await attendanceIds({
        startAttendanceDateInclusive: "2026-08-23",
        endAttendanceDateInclusive: "2026-08-23",
        workPeriod: "night",
        includeCancelled: true,
      }),
      [],
    );
    assert.deepEqual(
      await attendanceIds({
        startAttendanceDateInclusive: "2026-08-23",
        endAttendanceDateInclusive: "2026-08-24",
      }),
      [
        "33333333-3333-4333-8333-333333333333",
        "55555555-5555-4555-8555-555555555555",
        "44444444-4444-4444-8444-444444444444",
      ],
    );
    assert.deepEqual(
      await attendanceIds({
        userId: firstUserId,
        startAttendanceDateInclusive: "2026-08-23",
        endAttendanceDateInclusive: "2026-08-24",
      }),
      [
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
      ],
    );
    assert.deepEqual(await attendanceIds({ workPeriod: "night" }), [
      "33333333-3333-4333-8333-333333333333",
    ]);
    assert.deepEqual(await attendanceIds({ status: "working" }), [
      "33333333-3333-4333-8333-333333333333",
    ]);
    assert.deepEqual(
      await attendanceIds({
        startAttendanceDateInclusive: "2026-08-23",
        endAttendanceDateInclusive: "2026-08-24",
        userId: firstUserId,
        workPeriod: "night",
        status: "working",
      }),
      ["33333333-3333-4333-8333-333333333333"],
    );
    assert.deepEqual(await attendanceIds({ status: "completed" }), [
      "22222222-2222-4222-8222-222222222222",
      "55555555-5555-4555-8555-555555555555",
      "44444444-4444-4444-8444-444444444444",
    ]);
  });
});

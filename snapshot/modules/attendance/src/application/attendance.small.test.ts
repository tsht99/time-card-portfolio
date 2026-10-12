import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import test from "node:test";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
} from "../domain/attendance.ts";
import { AttendanceTimeOverlapError } from "../domain/attendance-overlap.ts";
import {
  AttendanceAccessForbiddenError,
  AttendanceClockProcessingDateMismatchError,
  AttendanceEventStreamNotFoundError,
  AttendanceManualCreationForbiddenError,
  AttendanceManualCreationTargetNotApprovedError,
  AttendanceManualCreationTargetNotFoundError,
  createAttendanceApplication,
} from "./attendance.ts";
import {
  AttendanceCancellationCommandRejectedError,
  AttendanceCancellationForbiddenError,
  AttendanceCancellationVersionConflictError,
} from "./attendance-cancellation.ts";
import { AttendanceClockStaleError } from "./attendance-clock.ts";
import {
  AttendanceCorrectionCommandRejectedError,
  AttendanceCorrectionForbiddenError,
  AttendanceCorrectionVersionConflictError,
} from "./attendance-correction.ts";
import type { AttendanceCurrentState } from "./attendance-current-state.ts";
import { AttendanceManualCreationCommandRejectedError } from "./attendance-manual-creation.ts";
import { createAttendancePayrollProjectionReader } from "./attendance-payroll-projection-reader.ts";
import { replayAttendanceCurrentStatesFromEvents } from "./attendance-replay.ts";
import type { AttendanceEventHistoryItem } from "./attendance-types.ts";
import type {
  AttendanceCurrentStateQuery,
  AttendanceCurrentStateQueryResult,
  AttendanceCurrentStateReadModel,
} from "./ports/attendance-current-state-read-model.ts";
import type {
  AttendanceEventAppendOptions,
  AttendanceEventStore,
  StoredAttendanceEvent,
} from "./ports/attendance-event-store.ts";
import type {
  AttendanceTransactionUnitOfWork,
  AttendanceUserReferenceReader,
} from "./ports/attendance-user-reference.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const staff = {
  userId,
  displayName: "スタッフ",
  role: "staff",
  status: "active",
} as const;
const admin = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  displayName: "管理者",
  role: "admin",
  status: "active",
} as const;

test("AttendanceEventHistoryItemはeventTypeに対応しないpayloadとDateを拒否する", () => {
  const mismatchedPayload: AttendanceEventHistoryItem = {
    eventId: "event-1",
    attendanceId: "attendance-1",
    eventVersion: 1,
    eventType: "AttendanceClockedIn",
    performedByUserId: userId,
    createdAt: "2026-08-22T00:00:00.000Z",
    // @ts-expect-error AttendanceClockedInはclockOutAt payloadを持たない。
    payload: { clockOutAt: "2026-08-22T18:00:00.000Z" },
  };
  const dateAtUiBoundary: AttendanceEventHistoryItem = {
    eventId: "event-2",
    attendanceId: "attendance-1",
    eventVersion: 2,
    eventType: "ClockInTimeCorrected",
    performedByUserId: userId,
    createdAt: "2026-08-22T00:00:00.000Z",
    // @ts-expect-error ApplicationからUIへ渡す日時はstringである。
    payload: { clockInAt: new Date("2026-08-22T10:00:00.000Z") },
  };
  strictEqual(mismatchedPayload.eventType, "AttendanceClockedIn");
  strictEqual(dateAtUiBoundary.eventType, "ClockInTimeCorrected");
});

function clockIn(
  attendanceId = "attendance-1",
  attendanceDate = "2026-08-22",
  workPeriod: "day" | "night" = "day",
  clockInAt = new Date(`${attendanceDate}T00:00:00.000Z`),
  ownerUserId = userId,
): StoredAttendanceEvent {
  return {
    eventId: `event-${attendanceId}`,
    attendanceId,
    eventVersion: 1,
    eventType: "AttendanceClockedIn",
    performedByUserId: userId,
    createdAt: new Date("2026-08-22T00:00:00.000Z"),
    payload: {
      userId: ownerUserId,
      attendanceDate,
      workPeriod,
      clockInAt,
    },
  };
}

function clockOut(
  attendanceId = "attendance-1",
  occurredAt = new Date("2026-08-22T01:00:00.000Z"),
  createdAt = occurredAt,
): StoredAttendanceEvent {
  return {
    eventId: `event-${attendanceId}-out`,
    attendanceId,
    eventVersion: 2,
    eventType: "AttendanceClockedOut",
    performedByUserId: userId,
    createdAt,
    payload: { clockOutAt: occurredAt },
  };
}

function correctedClockIn(): StoredAttendanceEvent {
  return {
    eventId: "event-attendance-1-correct-in",
    attendanceId: "attendance-1",
    eventVersion: 4,
    eventType: "ClockInTimeCorrected",
    performedByUserId: userId,
    createdAt: new Date("2026-08-22T13:00:00.000Z"),
    payload: { clockInAt: new Date("2026-08-22T10:00:00.000Z") },
  };
}

function correctedClockOut(): StoredAttendanceEvent {
  return {
    eventId: "event-attendance-1-correct-out",
    attendanceId: "attendance-1",
    eventVersion: 5,
    eventType: "ClockOutTimeCorrected",
    performedByUserId: userId,
    createdAt: new Date("2026-08-22T14:00:00.000Z"),
    payload: { clockOutAt: new Date("2026-08-22T19:00:00.000Z") },
  };
}

function correctedWorkPeriod(): StoredAttendanceEvent {
  return {
    eventId: "event-attendance-1-correct-period",
    attendanceId: "attendance-1",
    eventVersion: 3,
    eventType: "WorkPeriodCorrected",
    performedByUserId: userId,
    createdAt: new Date("2026-08-22T12:30:00.000Z"),
    payload: { workPeriod: "night" },
  };
}

function cancelledClockIn(): StoredAttendanceEvent {
  return {
    eventId: "event-attendance-1-cancel-in",
    attendanceId: "attendance-1",
    eventVersion: 6,
    eventType: "AttendanceCancelled",
    performedByUserId: userId,
    createdAt: new Date("2026-08-22T15:00:00.000Z"),
    payload: {},
  };
}

class FakeStore implements AttendanceEventStore {
  readonly appended: Array<{
    events: readonly AttendanceDomainEvent[];
    options: AttendanceEventAppendOptions;
  }> = [];
  readAllCalls = 0;
  readonly readStreamCalls: string[] = [];
  readonly readStreamsByUserIdCalls: string[] = [];
  validationConflicts?: Awaited<
    ReturnType<AttendanceEventStore["findCurrentStateValidationConflicts"]>
  >;

  constructor(readonly events: StoredAttendanceEvent[] = []) {}

  async runExclusive<T>(
    _lock: import("./ports/attendance-event-store.ts").AttendanceLock,
    operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  async readAll() {
    this.readAllCalls += 1;
    return this.events;
  }

  async readStream(attendanceId: string) {
    this.readStreamCalls.push(attendanceId);
    return this.events
      .filter((event) => event.attendanceId === attendanceId)
      .sort((left, right) => left.eventVersion - right.eventVersion);
  }

  async readStreamsByUserId(id: string) {
    this.readStreamsByUserIdCalls.push(id);
    const attendanceIds = new Set(
      this.events.flatMap((event) =>
        event.eventType === "AttendanceClockedIn" && event.payload.userId === id
          ? [event.attendanceId]
          : [],
      ),
    );
    return this.events.filter((event) => attendanceIds.has(event.attendanceId));
  }

  async findCurrentStateValidationConflicts(
    _query: Parameters<
      AttendanceEventStore["findCurrentStateValidationConflicts"]
    >[0],
  ) {
    return (
      this.validationConflicts ?? {
        kind: "ready" as const,
        hasWorkingAttendance: false,
        hasClockInTimeConflict: false,
        hasOverlap: false,
      }
    );
  }

  async append(
    events: readonly AttendanceDomainEvent[],
    options: AttendanceEventAppendOptions,
  ) {
    this.appended.push({ events, options });
    this.events.push(
      ...events.map((event, index) => ({
        ...event,
        eventId: `appended-${index}`,
        performedByUserId: options.performedByUserId,
        createdAt: new Date("2026-08-22T12:00:00.000Z"),
      })),
    );
  }
}

function fakeTransactionUnitOfWork(
  users: AttendanceUserReferenceReader,
  eventStore: AttendanceEventStore,
): AttendanceTransactionUnitOfWork {
  return {
    runInTransaction: (operation) => operation({ users, eventStore }),
  };
}

class FakeCurrentStateReadModel implements AttendanceCurrentStateReadModel {
  readonly queries: AttendanceCurrentStateQuery[] = [];

  constructor(
    private readonly result: AttendanceCurrentStateQueryResult | Error,
  ) {}

  async upsert(_state: AttendanceCurrentState): Promise<void> {}

  async remove(_attendanceId: string): Promise<void> {}

  async query(
    query: AttendanceCurrentStateQuery,
  ): Promise<AttendanceCurrentStateQueryResult> {
    this.queries.push(query);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class FilteringCurrentStateReadModel
  implements AttendanceCurrentStateReadModel
{
  readonly queries: AttendanceCurrentStateQuery[] = [];

  constructor(
    private readonly states: readonly AttendanceCurrentState[],
    private readonly isReady = true,
  ) {}

  async upsert(_state: AttendanceCurrentState): Promise<void> {}

  async query(
    query: AttendanceCurrentStateQuery,
  ): Promise<AttendanceCurrentStateQueryResult> {
    this.queries.push(query);
    if (!this.isReady) return { kind: "not-ready" };
    return {
      kind: "ready",
      states: this.states.filter(
        (state) =>
          (query.startAttendanceDateInclusive === undefined ||
            state.attendanceDate >= query.startAttendanceDateInclusive) &&
          (query.endAttendanceDateInclusive === undefined ||
            state.attendanceDate <= query.endAttendanceDateInclusive) &&
          (query.userId === undefined || state.userId === query.userId) &&
          (query.workPeriod === undefined ||
            state.workPeriod === query.workPeriod) &&
          (query.status === undefined ||
            (query.status === "working"
              ? state.clockOutAt === null
              : state.clockOutAt !== null)) &&
          (query.includeAllCancellationStates === true ||
            state.isCancelled === (query.includeCancelled === true)),
      ),
    };
  }
}

class SequencedCurrentStateReadModel
  implements AttendanceCurrentStateReadModel
{
  readonly queries: AttendanceCurrentStateQuery[] = [];

  constructor(
    private readonly results: Array<AttendanceCurrentStateQueryResult | Error>,
  ) {}

  async upsert(_state: AttendanceCurrentState): Promise<void> {}

  async remove(_attendanceId: string): Promise<void> {}

  async query(
    query: AttendanceCurrentStateQuery,
  ): Promise<AttendanceCurrentStateQueryResult> {
    this.queries.push(query);
    const result = this.results.shift();
    if (!result) throw new Error("unexpected Current State query");
    if (result instanceof Error) throw result;
    return result;
  }
}

function currentState(
  attendanceId: string,
  attendanceDate: string,
  workPeriod: "day" | "night",
  clockOutAt: Date | null = null,
): AttendanceCurrentState {
  return {
    attendanceId,
    userId,
    attendanceDate,
    workPeriod,
    clockInAt: new Date(`${attendanceDate}T00:00:00.000Z`),
    clockOutAt,
    eventVersion: 1,
    isCancelled: false,
  };
}

function cancelledStream(
  attendanceId: string,
  options: {
    userId?: string;
    attendanceDate?: string;
    workPeriod?: "day" | "night";
    correctedClockInAt?: Date;
  } = {},
): StoredAttendanceEvent[] {
  const aggregate = AttendanceAggregate.start(attendanceId);
  const attendanceDate = options.attendanceDate ?? "2026-08-22";
  const events: AttendanceDomainEvent[] = [
    aggregate.clockIn({
      userId: options.userId ?? userId,
      workPeriod: options.workPeriod ?? "day",
      attendanceDate,
      clockInAt: new Date(`${attendanceDate}T09:00:00.000Z`),
    }),
  ];
  if (options.correctedClockInAt) {
    events.push(
      aggregate.correctClockInTime({ clockInAt: options.correctedClockInAt }),
    );
  }
  events.push(aggregate.cancel());
  return events.map((event) => ({
    ...event,
    eventId: `${attendanceId}-${event.eventVersion}`,
    performedByUserId: admin.userId,
    createdAt: new Date("2026-08-22T12:00:00.000Z"),
  }));
}

function createApplication(
  store: FakeStore,
  findUser: (userId: string) => Promise<{
    userId: string;
    role: string;
    status: string;
  } | null> = async (targetUserId) =>
    targetUserId === userId
      ? { userId, role: "staff", status: "active" }
      : targetUserId === admin.userId
        ? { userId: admin.userId, role: "admin", status: "active" }
        : null,
  currentStateReadModel: AttendanceCurrentStateReadModel = new FakeCurrentStateReadModel(
    { kind: "not-ready" },
  ),
  now = new Date("2026-08-22T12:00:00.000Z"),
) {
  const targetReader = findUser;
  const userReferences = {
    getUsers: async () => [
      { userId, displayName: "スタッフ", role: "staff", status: "active" },
    ],
    getUserById: async (targetUserId: string) => {
      const current = await targetReader(targetUserId);
      if (current !== null) return current;
      return targetUserId === admin.userId
        ? { userId: admin.userId, role: "admin", status: "active" }
        : null;
    },
  };
  const transactionUnitOfWork: AttendanceTransactionUnitOfWork = {
    runInTransaction: (operation) =>
      operation({
        users: userReferences,
        eventStore: store,
      }),
  };
  return createAttendanceApplication({
    eventStore: store,
    currentStateReadModel,
    now: () => now,
    userReferences,
    transactionUnitOfWork,
  });
}

test("月次勤怠検索は西暦1桁・2桁でもYYYY-MM-DD形式の日付範囲を渡す", async () => {
  const readModel = new FakeCurrentStateReadModel({
    kind: "ready",
    states: [],
  });
  const application = createApplication(
    new FakeStore([]),
    undefined,
    readModel,
  );

  await application.getAttendanceHistory({ userId }, "0001-01");
  await application.getAttendanceHistory({ userId }, "0099-12");

  deepStrictEqual(readModel.queries, [
    {
      userId,
      startAttendanceDateInclusive: "0001-01-01",
      endAttendanceDateInclusive: "0001-01-31",
    },
    {
      userId,
      startAttendanceDateInclusive: "0099-12-01",
      endAttendanceDateInclusive: "0099-12-31",
    },
  ]);
});

test("applicationはnot-readyの間だけEvent Stream replayから一覧filterとcurrent readを組み立てる", async () => {
  const store = new FakeStore([clockIn(), clockIn("attendance-2")]);
  const application = createApplication(store);

  const list = await application.getAdminAttendance(admin, {
    startAttendanceDateInclusive: "2026-08-22",
    endAttendanceDateInclusive: "2026-08-22",
    status: "working",
  });
  const current = await application.getStaffCurrentAttendance({ userId });

  deepStrictEqual(
    list.attendances.map(({ attendanceId, attendanceDate, status }) => ({
      attendanceId,
      attendanceDate,
      status,
    })),
    [
      {
        attendanceId: "attendance-1",
        attendanceDate: "2026-08-22",
        status: "working",
      },
      {
        attendanceId: "attendance-2",
        attendanceDate: "2026-08-22",
        status: "working",
      },
    ],
  );
  strictEqual(current.referenceDate, "2026-08-22");
  deepStrictEqual(
    current.attendances.map(({ attendanceId, attendanceDate }) => ({
      attendanceId,
      attendanceDate,
    })),
    [
      { attendanceId: "attendance-1", attendanceDate: "2026-08-22" },
      { attendanceId: "attendance-2", attendanceDate: "2026-08-22" },
    ],
  );
  strictEqual(store.readAllCalls, 1);
  deepStrictEqual(store.readStreamsByUserIdCalls, [userId]);
});

test("not-ready時のcurrent state replayは補正後の全query条件を適用する", async () => {
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  const corrected = AttendanceAggregate.start("corrected");
  const correctedEvents: AttendanceDomainEvent[] = [
    corrected.clockIn({
      userId,
      workPeriod: "day",
      attendanceDate: "2026-08-31",
      clockInAt: new Date("2026-08-31T01:00:00.000Z"),
    }),
    corrected.correctClockInTime({
      clockInAt: new Date("2026-09-01T01:00:00.000Z"),
    }),
    corrected.correctWorkPeriod({ workPeriod: "night" }),
  ];
  const completed = AttendanceAggregate.start("completed");
  const completedEvents: AttendanceDomainEvent[] = [
    completed.clockIn({
      userId,
      workPeriod: "night",
      attendanceDate: "2026-09-02",
      clockInAt: new Date("2026-09-02T01:00:00.000Z"),
    }),
    completed.clockOut({ clockOutAt: new Date("2026-09-02T10:00:00.000Z") }),
  ];
  const store = new FakeStore([
    ...correctedEvents.map((event) => ({
      ...event,
      eventId: `${event.attendanceId}-${event.eventVersion}`,
      performedByUserId: admin.userId,
      createdAt: new Date("2026-09-02T12:00:00.000Z"),
    })),
    ...completedEvents.map((event) => ({
      ...event,
      eventId: `${event.attendanceId}-${event.eventVersion}`,
      performedByUserId: admin.userId,
      createdAt: new Date("2026-09-02T12:00:00.000Z"),
    })),
    ...cancelledStream("cancelled", {
      attendanceDate: "2026-09-03",
      workPeriod: "night",
    }),
    ...cancelledStream("other-user", {
      userId: otherUserId,
      attendanceDate: "2026-09-03",
      workPeriod: "night",
    }),
    clockIn("before", "2026-08-31", "night"),
    clockIn("after", "2026-09-04", "night"),
  ]);
  const readModel = new FakeCurrentStateReadModel({ kind: "not-ready" });
  const payrollReader = createAttendancePayrollProjectionReader({
    eventStore: store,
    currentStateReadModel: readModel,
  });

  const states = await payrollReader.getPayrollProjectionStates({
    startAttendanceDateInclusive: "2026-09-01",
    endAttendanceDateInclusive: "2026-09-03",
    userId,
    workPeriod: "night",
    status: "working",
  });

  deepStrictEqual(
    states.map(({ attendanceId }) => attendanceId),
    ["corrected"],
  );
  strictEqual(states[0]?.attendanceDate, "2026-09-01");
  strictEqual(states[0]?.workPeriod, "night");
  deepStrictEqual(store.readStreamsByUserIdCalls, [userId]);
  const readyReadModel = new FakeCurrentStateReadModel({
    kind: "ready",
    states,
  });
  const readyPayrollReader = createAttendancePayrollProjectionReader({
    eventStore: store,
    currentStateReadModel: readyReadModel,
  });
  deepStrictEqual(
    await readyPayrollReader.getPayrollProjectionStates({
      startAttendanceDateInclusive: "2026-09-01",
      endAttendanceDateInclusive: "2026-09-03",
      userId,
      workPeriod: "night",
      status: "working",
    }),
    states,
  );
});

test("not-ready時のcurrent state replayは一方の期間境界・status・取消指定を適用する", async () => {
  const store = new FakeStore([
    clockIn("boundary-start", "2026-08-22"),
    clockIn("boundary-end", "2026-08-23"),
    clockOut("boundary-end", new Date("2026-08-23T12:00:00.000Z")),
    ...cancelledStream("cancelled-boundary", { attendanceDate: "2026-08-23" }),
  ]);
  const readModel = new FakeCurrentStateReadModel({ kind: "not-ready" });
  const payrollReader = createAttendancePayrollProjectionReader({
    eventStore: store,
    currentStateReadModel: readModel,
  });

  deepStrictEqual(
    (
      await payrollReader.getPayrollProjectionStates({
        startAttendanceDateInclusive: "2026-08-23",
        status: "completed",
      })
    ).map(({ attendanceId }) => attendanceId),
    ["boundary-end"],
  );
  deepStrictEqual(
    (
      await payrollReader.getPayrollProjectionStates({
        endAttendanceDateInclusive: "2026-08-22",
        status: "working",
        includeCancelled: false,
      })
    ).map(({ attendanceId }) => attendanceId),
    ["boundary-start"],
  );
  deepStrictEqual(
    (
      await payrollReader.getPayrollProjectionStates({
        startAttendanceDateInclusive: "2026-08-23",
        includeCancelled: true,
      })
    ).map(({ attendanceId }) => attendanceId),
    ["cancelled-boundary"],
  );
  deepStrictEqual(
    (
      await payrollReader.getPayrollProjectionStates({
        startAttendanceDateInclusive: "2026-08-23",
      })
    ).map(({ attendanceId }) => attendanceId),
    ["boundary-end"],
  );
});

test("applicationはreadyなCurrent State Read Modelから通常readを組み立てる", async () => {
  const readModel = new FakeCurrentStateReadModel({
    kind: "ready",
    states: [
      currentState("working-before-today", "2026-08-21", "night"),
      currentState("working-today", "2026-08-22", "day"),
      currentState(
        "completed-today",
        "2026-08-22",
        "night",
        new Date("2026-08-22T01:00:00.000Z"),
      ),
      currentState(
        "completed-today-day",
        "2026-08-22",
        "day",
        new Date("2026-08-22T01:00:00.000Z"),
      ),
      currentState(
        "outside-month",
        "2026-07-31",
        "day",
        new Date("2026-07-31T01:00:00.000Z"),
      ),
      currentState("outside-admin-range", "2026-07-31", "day"),
    ],
  });
  const store = new FakeStore([clockIn()]);
  const userReferences: AttendanceUserReferenceReader = {
    getUsers: async () => [
      { userId, displayName: "スタッフ", role: "staff", status: "active" },
    ],
    getUserById: async (id) =>
      id === admin.userId
        ? { userId: admin.userId, role: "admin", status: "active" }
        : id === userId
          ? { userId, role: "staff", status: "active" }
          : null,
  };
  let nowCalls = 0;
  const application = createAttendanceApplication({
    eventStore: store,
    currentStateReadModel: readModel,
    now: () => {
      nowCalls += 1;
      return new Date("2026-08-22T12:00:00.000Z");
    },
    userReferences,
    transactionUnitOfWork: fakeTransactionUnitOfWork(userReferences, store),
  });

  const list = await application.getAdminAttendance(admin, {
    startAttendanceDateInclusive: "2026-08-01",
    endAttendanceDateInclusive: "2026-08-31",
    userId,
    workPeriod: "day",
    status: "working",
  });
  const current = await application.getStaffCurrentAttendance({ userId });
  const history = await application.getAttendanceHistory({ userId }, "2026-08");

  deepStrictEqual(readModel.queries, [
    {
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId,
      workPeriod: "day",
      includeAllCancellationStates: true,
    },
    {
      userId,
      attendanceDateOrWorking: "2026-08-22",
    },
    {
      userId,
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
    },
  ]);
  deepStrictEqual(
    list.attendances.map(({ attendanceId, attendanceDate, status }) => ({
      attendanceId,
      attendanceDate,
      status,
    })),
    [
      {
        attendanceId: "working-today",
        attendanceDate: "2026-08-22",
        status: "working",
      },
    ],
  );
  strictEqual(current.referenceDate, "2026-08-22");
  strictEqual(nowCalls, 1);
  deepStrictEqual(
    current.attendances.map((attendance) => attendance.attendanceId).sort(),
    [
      "completed-today",
      "completed-today-day",
      "outside-admin-range",
      "working-before-today",
      "working-today",
    ].sort(),
  );
  strictEqual(current.attendances.length, 5);
  strictEqual(
    new Set(current.attendances.map(({ attendanceId }) => attendanceId)).size,
    current.attendances.length,
  );
  deepStrictEqual(
    current.attendances
      .filter(({ clockOutAt }) => clockOutAt === null)
      .map((attendance) => attendance.attendanceId),
    ["working-before-today", "working-today", "outside-admin-range"].sort(),
  );
  deepStrictEqual(
    history.map((item) => item.attendanceDate),
    ["2026-08-22", "2026-08-22", "2026-08-22", "2026-08-21"],
  );
  deepStrictEqual(
    history
      .filter(
        ({ attendanceDate, workPeriod }) =>
          attendanceDate === "2026-08-22" && workPeriod === "day",
      )
      .map((attendance) => attendance.attendanceId),
    ["completed-today-day", "working-today"],
  );
  strictEqual(store.readAllCalls, 0);
  deepStrictEqual(store.readStreamsByUserIdCalls, []);
});

test("applicationはCurrent State Read Modelのquery errorをreplayへfallbackしない", async () => {
  const error = new Error("projection query failed");
  const store = new FakeStore([clockIn()]);
  const readModel = new FakeCurrentStateReadModel(error);
  const application = createApplication(store, undefined, readModel);

  await rejects(application.getStaffCurrentAttendance({ userId }), error);
  strictEqual(readModel.queries.length, 1);
  strictEqual(store.readAllCalls, 0);
  deepStrictEqual(store.readStreamsByUserIdCalls, []);
});

test("staff current queryがnot-readyなら一度だけEvent Streamをreplayする", async () => {
  const store = new FakeStore([clockIn()]);
  const readModel = new SequencedCurrentStateReadModel([{ kind: "not-ready" }]);
  const application = createApplication(store, undefined, readModel);

  const current = await application.getStaffCurrentAttendance({ userId });

  deepStrictEqual(readModel.queries, [
    {
      userId,
      attendanceDateOrWorking: "2026-08-22",
    },
  ]);
  deepStrictEqual(
    current.attendances.map(({ attendanceId }) => attendanceId),
    ["attendance-1"],
  );
  strictEqual(store.readAllCalls, 0);
  deepStrictEqual(store.readStreamsByUserIdCalls, [userId]);
});

test("applicationはevent historyをDTO化し、日時payloadをISO文字列へ変換する", async () => {
  const readModel = new FakeCurrentStateReadModel(
    new Error("projection query failed"),
  );
  const application = createApplication(
    new FakeStore([
      clockIn(
        "attendance-1",
        "2026-08-22",
        "day",
        new Date("2026-08-22T09:00:00.000Z"),
      ),
      clockOut(
        "attendance-1",
        new Date("2026-08-22T18:00:00.000Z"),
        new Date("2026-08-22T12:00:00.000Z"),
      ),
      correctedWorkPeriod(),
      correctedClockIn(),
      correctedClockOut(),
      cancelledClockIn(),
    ]),
    undefined,
    readModel,
  );
  const events = await application.getAttendanceEventHistory(
    admin,
    "attendance-1",
  );

  deepStrictEqual(
    events.map(({ eventType, createdAt, payload }) => ({
      eventType,
      createdAt,
      payload,
    })),
    [
      {
        eventType: "AttendanceClockedIn",
        createdAt: "2026-08-22T00:00:00.000Z",
        payload: {
          userId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockInAt: "2026-08-22T09:00:00.000Z",
        },
      },
      {
        eventType: "AttendanceClockedOut",
        createdAt: "2026-08-22T12:00:00.000Z",
        payload: { clockOutAt: "2026-08-22T18:00:00.000Z" },
      },
      {
        eventType: "WorkPeriodCorrected",
        createdAt: "2026-08-22T12:30:00.000Z",
        payload: { workPeriod: "night" },
      },
      {
        eventType: "ClockInTimeCorrected",
        createdAt: "2026-08-22T13:00:00.000Z",
        payload: { clockInAt: "2026-08-22T10:00:00.000Z" },
      },
      {
        eventType: "ClockOutTimeCorrected",
        createdAt: "2026-08-22T14:00:00.000Z",
        payload: { clockOutAt: "2026-08-22T19:00:00.000Z" },
      },
      {
        eventType: "AttendanceCancelled",
        createdAt: "2026-08-22T15:00:00.000Z",
        payload: {},
      },
    ],
  );
  await rejects(
    application.getAttendanceEventHistory(admin, "missing"),
    AttendanceEventStreamNotFoundError,
  );
  strictEqual(readModel.queries.length, 0);
});

test("applicationは同じEvent Streamから現在状態とhistoryを生成する", async () => {
  const cancelled = cancelledStream("cancelled", {
    workPeriod: "night",
    correctedClockInAt: new Date("2026-08-22T10:00:00.000Z"),
  });
  const store = new FakeStore([
    clockIn(
      "completed",
      "2026-08-22",
      "day",
      new Date("2026-08-22T09:00:00.000Z"),
    ),
    clockOut(
      "completed",
      new Date("2026-08-22T18:00:00.000Z"),
      new Date("2026-08-22T18:01:00.000Z"),
    ),
    clockIn(
      "working",
      "2026-08-23",
      "day",
      new Date("2026-08-23T09:00:00.000Z"),
    ),
    ...cancelled,
  ]);
  const application = createApplication(store);

  const completed = await application.getAdminAttendanceDetail(
    admin,
    "completed",
  );
  const working = await application.getAdminAttendanceDetail(admin, "working");
  const cancelledDetail = await application.getAdminAttendanceDetail(
    admin,
    "cancelled",
  );

  deepStrictEqual(completed, {
    attendanceId: "completed",
    eventVersion: 2,
    attendanceDate: "2026-08-22",
    userId,
    displayName: "スタッフ",
    workPeriod: "day",
    clockInAt: "2026-08-22T09:00:00.000Z",
    clockOutAt: "2026-08-22T18:00:00.000Z",
    workedMinutes: 540,
    status: "completed",
    history: [
      {
        eventId: "event-completed",
        attendanceId: "completed",
        eventVersion: 1,
        eventType: "AttendanceClockedIn",
        performedByUserId: userId,
        createdAt: "2026-08-22T00:00:00.000Z",
        payload: {
          userId,
          attendanceDate: "2026-08-22",
          workPeriod: "day",
          clockInAt: "2026-08-22T09:00:00.000Z",
        },
      },
      {
        eventId: "event-completed-out",
        attendanceId: "completed",
        eventVersion: 2,
        eventType: "AttendanceClockedOut",
        performedByUserId: userId,
        createdAt: "2026-08-22T18:01:00.000Z",
        payload: { clockOutAt: "2026-08-22T18:00:00.000Z" },
      },
    ],
  });
  deepStrictEqual(
    {
      attendanceId: working.attendanceId,
      eventVersion: working.eventVersion,
      attendanceDate: working.attendanceDate,
      displayName: working.displayName,
      clockOutAt: working.clockOutAt,
      workedMinutes: working.workedMinutes,
      status: working.status,
      history: working.history.map(({ eventType, eventVersion }) => ({
        eventType,
        eventVersion,
      })),
    },
    {
      attendanceId: "working",
      eventVersion: 1,
      attendanceDate: "2026-08-23",
      displayName: "スタッフ",
      clockOutAt: null,
      workedMinutes: null,
      status: "working",
      history: [{ eventType: "AttendanceClockedIn", eventVersion: 1 }],
    },
  );
  deepStrictEqual(
    {
      attendanceId: cancelledDetail.attendanceId,
      eventVersion: cancelledDetail.eventVersion,
      attendanceDate: cancelledDetail.attendanceDate,
      userId: cancelledDetail.userId,
      displayName: cancelledDetail.displayName,
      workPeriod: cancelledDetail.workPeriod,
      clockInAt: cancelledDetail.clockInAt,
      clockOutAt: cancelledDetail.clockOutAt,
      workedMinutes: cancelledDetail.workedMinutes,
      status: cancelledDetail.status,
      history: cancelledDetail.history.map(({ eventType, eventVersion }) => ({
        eventType,
        eventVersion,
      })),
    },
    {
      attendanceId: "cancelled",
      eventVersion: 3,
      attendanceDate: "2026-08-22",
      userId,
      displayName: "スタッフ",
      workPeriod: "night",
      clockInAt: "2026-08-22T10:00:00.000Z",
      clockOutAt: null,
      workedMinutes: null,
      status: "cancelled",
      history: [
        { eventType: "AttendanceClockedIn", eventVersion: 1 },
        { eventType: "ClockInTimeCorrected", eventVersion: 2 },
        { eventType: "AttendanceCancelled", eventVersion: 3 },
      ],
    },
  );
  await rejects(
    application.getAdminAttendanceDetail(admin, "missing"),
    AttendanceEventStreamNotFoundError,
  );
  deepStrictEqual(store.readStreamCalls, [
    "completed",
    "working",
    "cancelled",
    "missing",
  ]);
});

test("訂正・取消後もEvent historyは元イベントから連続して取得できる", async () => {
  const application = createApplication(new FakeStore([clockIn()]));

  await application.correct(admin, "attendance-1", {
    expectedVersion: 1,
    workPeriod: "night",
  });
  await application.cancel(admin, "attendance-1", {
    expectedVersion: 2,
  });

  const history = await application.getAttendanceEventHistory(
    admin,
    "attendance-1",
  );
  deepStrictEqual(
    history.map(({ eventVersion, eventType }) => ({
      eventVersion,
      eventType,
    })),
    [
      { eventVersion: 1, eventType: "AttendanceClockedIn" },
      { eventVersion: 2, eventType: "WorkPeriodCorrected" },
      { eventVersion: 3, eventType: "AttendanceCancelled" },
    ],
  );
});

test("applicationはactive staffによる勤怠訂正・取消を直接呼び出しても拒否する", async () => {
  const correctionStore = new FakeStore([clockIn()]);
  await rejects(
    createApplication(correctionStore).correct(staff, "attendance-1", {
      expectedVersion: 1,
      workPeriod: "night",
    }),
    AttendanceCorrectionForbiddenError,
  );
  strictEqual(correctionStore.appended.length, 0);

  const cancellationStore = new FakeStore([clockIn()]);
  await rejects(
    createApplication(cancellationStore).cancel(staff, "attendance-1", {
      expectedVersion: 1,
    }),
    AttendanceCancellationForbiddenError,
  );
  strictEqual(cancellationStore.appended.length, 0);
});

test("Applicationはstaffから管理者専用の一覧・詳細・event履歴を拒否し状態を変更しない", async () => {
  const store = new FakeStore([clockIn()]);
  const application = createApplication(store);
  const filters = {
    startAttendanceDateInclusive: "2026-08-01",
    endAttendanceDateInclusive: "2026-08-31",
  };

  await rejects(
    application.getAdminAttendance(staff, filters),
    AttendanceAccessForbiddenError,
  );
  await rejects(
    application.getAdminAttendanceDetail(staff, "attendance-1"),
    AttendanceAccessForbiddenError,
  );
  await rejects(
    application.getAttendanceEventHistory(staff, "attendance-1"),
    AttendanceAccessForbiddenError,
  );
  strictEqual(store.readStreamCalls.length, 0);
  strictEqual(store.appended.length, 0);
});

test("Applicationはinactive adminへ保護された勤怠詳細とevent historyを返さない", async () => {
  const store = new FakeStore([clockIn()]);
  const application = createApplication(store, async (id) =>
    id === admin.userId
      ? { userId: admin.userId, role: "admin", status: "inactive" }
      : { userId, role: "staff", status: "active" },
  );

  await rejects(
    application.getAdminAttendanceDetail(admin, "attendance-1"),
    AttendanceAccessForbiddenError,
  );
  await rejects(
    application.getAttendanceEventHistory(admin, "attendance-1"),
    AttendanceAccessForbiddenError,
  );
  strictEqual(store.readStreamCalls.length, 0);
});

test("ApplicationはDeliveryから渡されたrole/statusを認可に使わず現在のUser stateを使う", async () => {
  const store = new FakeStore();
  const application = createApplication(store, async (id) =>
    id === admin.userId
      ? { userId: admin.userId, role: "admin", status: "inactive" }
      : { userId, role: "staff", status: "active" },
  );
  const claimedAdmin = {
    userId: admin.userId,
    role: "admin",
    status: "active",
  };

  await rejects(
    application.createAdminAttendance(claimedAdmin, {
      userId,
      workPeriod: "day",
      clockInAt: "2026-08-22T09:00:00+09:00",
      clockOutAt: "2026-08-22T18:00:00+09:00",
    }),
    AttendanceManualCreationForbiddenError,
  );
  strictEqual(store.appended.length, 0);
});

test("管理者一覧はstaffとadminの勤怠を含む", async () => {
  const otherAdminId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const ownAdminAttendance = cancelledStream("own-admin", {
    userId: admin.userId,
  });
  const otherAdminAttendance = cancelledStream("other-admin", {
    userId: otherAdminId,
  });
  const store = new FakeStore([
    ...cancelledStream("staff-attendance"),
    ...ownAdminAttendance,
    ...otherAdminAttendance,
  ]);
  const users = [
    { userId, displayName: "スタッフ", role: "staff", status: "active" },
    {
      userId: admin.userId,
      displayName: "管理者",
      role: "admin",
      status: "active",
    },
    {
      userId: otherAdminId,
      displayName: "別管理者",
      role: "admin",
      status: "active",
    },
  ];
  const userReferences: AttendanceUserReferenceReader = {
    getUsers: async () => users,
    getUserById: async (id) => users.find((user) => user.userId === id) ?? null,
  };
  const application = createAttendanceApplication({
    eventStore: store,
    currentStateReadModel: new FakeCurrentStateReadModel({ kind: "not-ready" }),
    userReferences,
    transactionUnitOfWork: fakeTransactionUnitOfWork(userReferences, store),
  });
  const filters = {
    startAttendanceDateInclusive: "2026-08-01",
    endAttendanceDateInclusive: "2026-08-31",
  };

  const result = await application.getAdminAttendance(admin, filters);
  deepStrictEqual(result.attendances, []);
  deepStrictEqual(
    result.cancelledAttendances.map((item) => [item.userId, item.attendanceId]),
    [
      [userId, "staff-attendance"],
      [admin.userId, "own-admin"],
      [otherAdminId, "other-admin"],
    ],
  );
});

test("統合管理者一覧はprojectionを一度読み、通常statusと取消一覧を別々に整える", async () => {
  const fallbackStore = new FakeStore([
    clockIn("working"),
    clockIn("completed", "2026-08-22", "night"),
    clockOut("completed"),
    ...cancelledStream("cancelled"),
  ]);
  const states = replayAttendanceCurrentStatesFromEvents(
    fallbackStore.events,
    undefined,
    { includeCancelled: true },
  );
  const projection = new FilteringCurrentStateReadModel(states);
  let allUsersCalls = 0;
  const userReferences: AttendanceUserReferenceReader = {
    getUsers: async () => {
      allUsersCalls += 1;
      throw new Error("all users must not be loaded");
    },
    getUserById: async (id) =>
      id === admin.userId
        ? { userId: id, role: "admin", status: "active" }
        : id === userId
          ? { userId: id, role: "staff", status: "active" }
          : null,
  };
  const application = createAttendanceApplication({
    eventStore: fallbackStore,
    currentStateReadModel: projection,
    userReferences,
    transactionUnitOfWork: fakeTransactionUnitOfWork(
      userReferences,
      fallbackStore,
    ),
  });

  const result = await application.getAdminAttendance(admin, {
    startAttendanceDateInclusive: "2026-08-01",
    endAttendanceDateInclusive: "2026-08-31",
    userId,
  });

  deepStrictEqual(result.attendances, [
    {
      attendanceId: "working",
      eventVersion: 1,
      attendanceDate: "2026-08-22",
      userId,
      workPeriod: "day",
      clockInAt: "2026-08-22T00:00:00.000Z",
      clockOutAt: null,
      workedMinutes: null,
      status: "working",
    },
    {
      attendanceId: "completed",
      eventVersion: 2,
      attendanceDate: "2026-08-22",
      userId,
      workPeriod: "night",
      clockInAt: "2026-08-22T00:00:00.000Z",
      clockOutAt: "2026-08-22T01:00:00.000Z",
      workedMinutes: 60,
      status: "completed",
    },
  ]);
  deepStrictEqual(
    result.cancelledAttendances.map(({ userId: rowUserId, attendanceId }) => [
      rowUserId,
      attendanceId,
    ]),
    [[userId, "cancelled"]],
  );
  strictEqual(projection.queries.length, 1);
  strictEqual(projection.queries[0]?.includeAllCancellationStates, true);
  strictEqual(projection.queries[0]?.status, undefined);
  strictEqual(allUsersCalls, 0);

  const fallbackApplication = createAttendanceApplication({
    eventStore: fallbackStore,
    currentStateReadModel: new FilteringCurrentStateReadModel(states, false),
    userReferences,
    transactionUnitOfWork: fakeTransactionUnitOfWork(
      userReferences,
      fallbackStore,
    ),
  });
  deepStrictEqual(
    await fallbackApplication.getAdminAttendance(admin, {
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId,
    }),
    result,
  );
});

test("統合管理者一覧のnot-ready fallbackは同じuser stream replayから両状態を返す", async () => {
  const store = new FakeStore([
    clockIn("working"),
    ...cancelledStream("cancelled"),
  ]);
  const userReferences: AttendanceUserReferenceReader = {
    getUsers: async () => [],
    getUserById: async (id) =>
      id === admin.userId
        ? { userId: id, role: "admin", status: "active" }
        : id === userId
          ? { userId: id, role: "staff", status: "active" }
          : null,
  };
  const application = createAttendanceApplication({
    eventStore: store,
    currentStateReadModel: new FakeCurrentStateReadModel({ kind: "not-ready" }),
    userReferences,
    transactionUnitOfWork: fakeTransactionUnitOfWork(userReferences, store),
  });

  const result = await application.getAdminAttendance(admin, {
    startAttendanceDateInclusive: "2026-08-22",
    endAttendanceDateInclusive: "2026-08-22",
    userId,
  });

  deepStrictEqual(
    result.attendances.map(({ attendanceId }) => attendanceId),
    ["working"],
  );
  deepStrictEqual(
    result.cancelledAttendances.map(({ attendanceId }) => attendanceId),
    ["cancelled"],
  );
  deepStrictEqual(store.readStreamsByUserIdCalls, [userId]);
  strictEqual(store.readAllCalls, 0);
});

test("active adminは他adminの勤怠詳細とevent historyを読める", async () => {
  const otherAdminId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const attendanceId = "other-admin-attendance";
  const inEvent = clockIn(
    attendanceId,
    "2026-08-22",
    "day",
    new Date("2026-08-22T00:00:00.000Z"),
    otherAdminId,
  );
  const outEvent = clockOut(attendanceId, new Date("2026-08-22T09:00:00.000Z"));
  const store = new FakeStore([inEvent, outEvent]);
  const users = [
    {
      userId: admin.userId,
      displayName: "管理者",
      role: "admin",
      status: "active",
    },
    {
      userId: otherAdminId,
      displayName: "別管理者",
      role: "admin",
      status: "active",
    },
  ];
  const userReferences: AttendanceUserReferenceReader = {
    getUsers: async () => users,
    getUserById: async (id) => users.find((user) => user.userId === id) ?? null,
  };
  const application = createAttendanceApplication({
    eventStore: store,
    currentStateReadModel: new FakeCurrentStateReadModel({ kind: "not-ready" }),
    userReferences,
    transactionUnitOfWork: fakeTransactionUnitOfWork(userReferences, store),
  });

  const detail = await application.getAdminAttendanceDetail(
    admin,
    attendanceId,
  );
  const history = await application.getAttendanceEventHistory(
    admin,
    attendanceId,
  );

  strictEqual(detail.userId, otherAdminId);
  deepStrictEqual(
    history.map(({ eventVersion }) => eventVersion),
    [1, 2],
  );
});

test("applicationは通常打刻をcommandへ変換して保存する", async () => {
  const knownStore = new FakeStore();
  const known = await createApplication(knownStore).clock(staff, {
    eventType: "clock_in",
    workPeriod: "day",
    occurredAt: "2026-08-22T09:00:00+09:00",
  });
  strictEqual(known.occurredAt, "2026-08-22T00:00:00.000Z");
  strictEqual(
    knownStore.appended[0]?.events[0]?.eventType,
    "AttendanceClockedIn",
  );
});

test("applicationは処理日と異なるJST日付の打刻を保存前に拒否する", async () => {
  const store = new FakeStore();
  await rejects(
    createApplication(store).clock(staff, {
      eventType: "clock_in",
      workPeriod: "day",
      occurredAt: "2026-08-23T00:00:00+09:00",
    }),
    AttendanceClockProcessingDateMismatchError,
  );
  strictEqual(store.appended.length, 0);
});

test("applicationはclock-out対象とversionをservice commandへ渡す", async () => {
  const store = new FakeStore([clockIn()]);
  const result = await createApplication(store).clock(staff, {
    eventType: "clock_out",
    workPeriod: "day",
    occurredAt: "2026-08-22T18:00:00+09:00",
    targetAttendanceId: "attendance-1",
    targetEventVersion: 1,
  });

  strictEqual(result.attendanceId, "attendance-1");
  strictEqual(store.appended[0]?.events[0]?.attendanceId, "attendance-1");
  strictEqual(store.appended[0]?.options.expectedVersion, 1);
});

test("applicationはserver時点のJST日付とrequest時刻をcommand/eventへ伝える", async () => {
  const cases = [
    {
      now: "2026-08-22T15:01:00Z",
      occurredAt: "2026-08-23T23:59:00+09:00",
      expectedAt: "2026-08-23T14:59:00.000Z",
    },
  ];

  for (const { now, occurredAt, expectedAt } of cases) {
    const store = new FakeStore();
    const result = await createApplication(
      store,
      undefined,
      undefined,
      new Date(now),
    ).clock(staff, {
      eventType: "clock_in",
      workPeriod: "day",
      occurredAt,
    });
    const event = store.appended[0]?.events[0];
    if (event?.eventType !== "AttendanceClockedIn") throw new Error();
    const expected = expectedAt;
    strictEqual(result.occurredAt, expected);
    strictEqual(event.payload.clockInAt.toISOString(), expected);
  }
});

test("applicationはactive adminがstaffとadmin本人のactive/inactive targetへ勤怠を新規作成できる", async () => {
  const cases = [
    { targetUserId: userId, role: "staff", status: "active" },
    {
      targetUserId: "22222222-2222-4222-8222-222222222222",
      role: "staff",
      status: "inactive",
    },
    {
      targetUserId: admin.userId,
      role: "admin",
      status: "active",
    },
  ] as const;

  for (const [index, target] of cases.entries()) {
    const store = new FakeStore();
    const application = createApplication(store, async (id) =>
      id === admin.userId
        ? { userId: admin.userId, role: "admin", status: "active" }
        : {
            userId: target.targetUserId,
            role: target.role,
            status: target.status,
          },
    );
    const request = {
      userId: target.targetUserId,
      workPeriod: "day" as const,
      clockInAt: `2026-08-${String(22 + index).padStart(2, "0")}T09:00:00+09:00`,
      clockOutAt: `2026-08-${String(22 + index).padStart(2, "0")}T18:00:00+09:00`,
    };

    const created = await application.createAdminAttendance(admin, request);
    strictEqual(created.attendanceId.length > 0, true);
    strictEqual(store.appended.length, 1);
    strictEqual(store.appended[0]?.options.performedByUserId, admin.userId);
    const event = store.events[0];
    if (event?.eventType !== "AttendanceClockedIn") throw new Error();
    strictEqual(event.payload.userId, target.targetUserId);
    strictEqual(event.performedByUserId, admin.userId);
  }
});

test("applicationは他のadminを対象にした勤怠新規作成を拒否する", async () => {
  const request = {
    userId: "33333333-3333-4333-8333-333333333333",
    workPeriod: "day" as const,
    clockInAt: "2026-08-22T09:00:00+09:00",
    clockOutAt: "2026-08-22T18:00:00+09:00",
  };
  for (const status of ["active", "inactive"] as const) {
    const store = new FakeStore();
    await rejects(
      createApplication(store, async (id) =>
        id === admin.userId
          ? { userId: admin.userId, role: "admin", status: "active" }
          : { userId: request.userId, role: "admin", status },
      ).createAdminAttendance(admin, request),
      AttendanceManualCreationForbiddenError,
    );
    strictEqual(store.appended.length, 0);
  }
});

test("applicationはactive admin以外のactorによる勤怠新規作成を拒否する", async () => {
  const request = {
    userId,
    workPeriod: "day" as const,
    clockInAt: "2026-08-22T09:00:00+09:00",
    clockOutAt: "2026-08-22T18:00:00+09:00",
  };
  for (const actorState of [
    { userId, role: "staff", status: "active" },
    { userId: admin.userId, role: "admin", status: "inactive" },
    { userId: admin.userId, role: "admin", status: "pending" },
  ]) {
    const store = new FakeStore();
    await rejects(
      createApplication(store, async (id) =>
        id === admin.userId
          ? actorState
          : { userId, role: "staff", status: "active" },
      ).createAdminAttendance({ userId: actorState.userId }, request),
      AttendanceManualCreationForbiddenError,
    );
    strictEqual(store.appended.length, 0);
  }
});

test("applicationはstaff/admin双方のpending targetと存在しないtargetを拒否しEventをappendしない", async () => {
  const request = {
    userId,
    workPeriod: "day" as const,
    clockInAt: "2026-08-22T09:00:00+09:00",
    clockOutAt: "2026-08-22T18:00:00+09:00",
  };
  const cases = [
    {
      findUser: async (id: string) =>
        id === admin.userId
          ? { userId: admin.userId, role: "admin", status: "active" }
          : null,
      error: AttendanceManualCreationTargetNotFoundError,
    },
    {
      findUser: async (id: string) =>
        id === admin.userId
          ? { userId: admin.userId, role: "admin", status: "active" }
          : { userId, role: "staff", status: "pending" },
      error: AttendanceManualCreationTargetNotApprovedError,
    },
    {
      findUser: async (id: string) =>
        id === admin.userId
          ? { userId: admin.userId, role: "admin", status: "active" }
          : { userId, role: "admin", status: "pending" },
      error: AttendanceManualCreationTargetNotApprovedError,
    },
  ] as const;

  for (const { findUser, error } of cases) {
    const store = new FakeStore();
    await rejects(
      createApplication(store, findUser).createAdminAttendance(admin, request),
      error,
    );
    strictEqual(store.appended.length, 0);
  }
});

test("applicationはstaffからadminへの変更後も勤怠履歴を保持し本人の操作を許可する", async () => {
  const store = new FakeStore();
  let targetRole: "staff" | "admin" = "staff";
  const findUser = async (id: string) =>
    id === admin.userId
      ? { userId: admin.userId, role: "admin", status: "active" }
      : { userId, role: targetRole, status: "active" };
  const application = createApplication(store, findUser);

  const created = await application.createAdminAttendance(admin, {
    userId,
    workPeriod: "day",
    clockInAt: "2026-08-22T09:00:00+09:00",
    clockOutAt: "2026-08-22T18:00:00+09:00",
  });
  targetRole = "admin";
  const previousVersion = store.events.length;
  await rejects(
    application.createAdminAttendance(admin, {
      userId,
      workPeriod: "day",
      clockInAt: "2026-08-23T09:00:00+09:00",
      clockOutAt: "2026-08-23T18:00:00+09:00",
    }),
    AttendanceManualCreationForbiddenError,
  );
  await rejects(
    application.correct(admin, created.attendanceId, {
      expectedVersion: previousVersion,
      workPeriod: "night",
    }),
    AttendanceCorrectionForbiddenError,
  );
  await rejects(
    application.cancel(admin, created.attendanceId, {
      expectedVersion: previousVersion,
    }),
    AttendanceCancellationForbiddenError,
  );
  strictEqual(store.events.length, previousVersion);
  strictEqual(store.appended.length, 1);
  await rejects(
    application.createAdminAttendance(
      { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      {
        userId,
        workPeriod: "day",
        clockInAt: "2026-08-24T09:00:00+09:00",
        clockOutAt: "2026-08-24T18:00:00+09:00",
      },
    ),
    AttendanceManualCreationForbiddenError,
  );

  const history = await application.getAttendanceHistory({ userId }, "2026-08");
  deepStrictEqual(
    history.map(({ attendanceDate }) => attendanceDate),
    ["2026-08-22"],
  );
});

test("applicationは訂正・取消を保存する", async () => {
  const correctionStore = new FakeStore([clockIn()]);
  const correctionApplication = createApplication(correctionStore);
  await correctionApplication.correct(admin, "attendance-1", {
    expectedVersion: 1,
    workPeriod: "day",
  });
  await correctionApplication.correct(admin, "attendance-1", {
    expectedVersion: 1,
    workPeriod: "night",
  });

  const cancellationStore = new FakeStore([clockIn()]);
  const cancelled = await createApplication(cancellationStore).cancel(
    admin,
    "attendance-1",
    {
      expectedVersion: 1,
    },
  );
  strictEqual(cancelled.attendanceId, "attendance-1");

  const clockOutCancellationStore = new FakeStore([clockIn(), clockOut()]);
  const clockOutCancelled = await createApplication(
    clockOutCancellationStore,
  ).cancel(admin, "attendance-1", {
    expectedVersion: 2,
  });
  strictEqual(clockOutCancelled.attendanceId, "attendance-1");
});

test("applicationは他のadminの勤怠の訂正・取消を拒否しEvent Streamを変更しない", async () => {
  const targetAdmin = {
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "対象管理者",
    role: "admin" as const,
    status: "active" as const,
  };
  const findUser = async (targetUserId: string) =>
    targetUserId === targetAdmin.userId
      ? {
          userId: targetAdmin.userId,
          role: targetAdmin.role,
          status: targetAdmin.status,
        }
      : null;

  const correctionEvents = [
    clockIn(
      "admin-attendance",
      "2026-08-22",
      "day",
      new Date("2026-08-22T09:00:00.000Z"),
      targetAdmin.userId,
    ),
  ];
  const correctionStore = new FakeStore(correctionEvents);
  const correctionApplication = createApplication(correctionStore, findUser);
  await rejects(
    correctionApplication.correct(admin, "admin-attendance", {
      expectedVersion: 1,
      workPeriod: "night",
    }),
    AttendanceCorrectionForbiddenError,
  );
  strictEqual(correctionStore.appended.length, 0);
  deepStrictEqual(
    correctionStore.events.map(({ eventVersion }) => eventVersion),
    [1],
  );

  const clockInCancellationEvents = [
    clockIn(
      "admin-clock-in-cancellation",
      "2026-08-22",
      "day",
      new Date("2026-08-22T09:00:00.000Z"),
      targetAdmin.userId,
    ),
  ];
  const clockInCancellationStore = new FakeStore(clockInCancellationEvents);
  const clockInCancellationApplication = createApplication(
    clockInCancellationStore,
    findUser,
  );
  await rejects(
    clockInCancellationApplication.cancel(
      admin,
      "admin-clock-in-cancellation",
      { expectedVersion: 1 },
    ),
    AttendanceCancellationForbiddenError,
  );
  strictEqual(clockInCancellationStore.appended.length, 0);
  deepStrictEqual(
    clockInCancellationStore.events.map(({ eventVersion }) => eventVersion),
    [1],
  );

  const clockOutCancellationEvents = [
    clockIn(
      "admin-clock-out-cancellation",
      "2026-08-22",
      "day",
      new Date("2026-08-22T09:00:00.000Z"),
      targetAdmin.userId,
    ),
    clockOut(
      "admin-clock-out-cancellation",
      new Date("2026-08-22T10:00:00.000Z"),
    ),
  ];
  const clockOutCancellationStore = new FakeStore(clockOutCancellationEvents);
  const clockOutCancellationApplication = createApplication(
    clockOutCancellationStore,
    findUser,
  );
  await rejects(
    clockOutCancellationApplication.cancel(
      admin,
      "admin-clock-out-cancellation",
      { expectedVersion: 2 },
    ),
    AttendanceCancellationForbiddenError,
  );
  strictEqual(clockOutCancellationStore.appended.length, 0);
  deepStrictEqual(
    clockOutCancellationStore.events.map(({ eventVersion }) => eventVersion),
    [1, 2],
  );
});

test("applicationはstaffの勤怠とadmin本人の勤怠を訂正・取消できる", async () => {
  const findUser = async (targetUserId: string) =>
    targetUserId === admin.userId
      ? { userId: admin.userId, role: "admin", status: "active" }
      : targetUserId === userId
        ? { userId, role: "staff", status: "active" }
        : null;

  const selfCorrectionStore = new FakeStore([
    clockIn(
      "self-admin-correction",
      "2026-08-22",
      "day",
      new Date("2026-08-22T09:00:00.000Z"),
      admin.userId,
    ),
  ]);
  await createApplication(selfCorrectionStore, findUser).correct(
    admin,
    "self-admin-correction",
    { expectedVersion: 1, workPeriod: "night" },
  );
  strictEqual(selfCorrectionStore.appended.length, 1);

  const selfCancellationStore = new FakeStore([
    clockIn(
      "self-admin-cancellation",
      "2026-08-22",
      "day",
      new Date("2026-08-22T09:00:00.000Z"),
      admin.userId,
    ),
  ]);
  await createApplication(selfCancellationStore, findUser).cancel(
    admin,
    "self-admin-cancellation",
    { expectedVersion: 1 },
  );
  strictEqual(selfCancellationStore.appended.length, 1);

  const staffCorrectionStore = new FakeStore([clockIn()]);
  await createApplication(staffCorrectionStore, findUser).correct(
    admin,
    "attendance-1",
    { expectedVersion: 1, workPeriod: "night" },
  );
  strictEqual(staffCorrectionStore.appended.length, 1);
});

test("applicationは対象ユーザーを取得できない訂正・取消を拒否する", async () => {
  const correctionStore = new FakeStore([clockIn()]);
  await rejects(
    createApplication(correctionStore, async () => null).correct(
      admin,
      "attendance-1",
      { expectedVersion: 1, workPeriod: "night" },
    ),
    AttendanceCorrectionForbiddenError,
  );
  strictEqual(correctionStore.appended.length, 0);

  const cancellationStore = new FakeStore([clockIn()]);
  await rejects(
    createApplication(cancellationStore, async () => null).cancel(
      admin,
      "attendance-1",
      { expectedVersion: 1 },
    ),
    AttendanceCancellationForbiddenError,
  );
  strictEqual(cancellationStore.appended.length, 0);
});

test("applicationはHTTP変換前のservice typed errorを保持する", async () => {
  const store = new FakeStore();
  const application = createApplication(store);

  await rejects(
    application.clock(staff, {
      eventType: "clock_out",
      workPeriod: "day",
      occurredAt: "2026-08-22T18:00:00+09:00",
      targetAttendanceId: "attendance-1",
      targetEventVersion: 1,
    }),
    AttendanceClockStaleError,
  );
  await rejects(
    createApplication(new FakeStore()).createAdminAttendance(admin, {
      userId,
      workPeriod: "day",
      clockInAt: "2026-08-22T18:00:00+09:00",
      clockOutAt: "2026-08-22T09:00:00+09:00",
    }),
    AttendanceManualCreationCommandRejectedError,
  );
  await rejects(
    application.correct(admin, "missing", {
      expectedVersion: 1,
      workPeriod: "day",
    }),
    AttendanceCorrectionCommandRejectedError,
  );
  await rejects(
    application.cancel(admin, "missing", {
      expectedVersion: 1,
    }),
    AttendanceCancellationCommandRejectedError,
  );

  const existingStore = new FakeStore([clockIn()]);
  const existingApplication = createApplication(existingStore);
  await rejects(
    existingApplication.correct(staff, "attendance-1", {
      expectedVersion: 1,
      workPeriod: "day",
    }),
    AttendanceCorrectionForbiddenError,
  );
  await rejects(
    existingApplication.correct(admin, "attendance-1", {
      expectedVersion: 2,
      workPeriod: "day",
    }),
    AttendanceCorrectionVersionConflictError,
  );
  await rejects(
    existingApplication.cancel(admin, "attendance-1", {
      expectedVersion: 2,
    }),
    AttendanceCancellationVersionConflictError,
  );

  const overlapStore = new FakeStore([
    clockIn(),
    clockOut(),
    clockIn(
      "overlapping-stream",
      "2026-08-22",
      "night",
      new Date("2026-08-22T00:30:00.000Z"),
    ),
    clockOut("overlapping-stream", new Date("2026-08-22T02:00:00.000Z")),
  ]);
  overlapStore.validationConflicts = {
    kind: "ready",
    hasWorkingAttendance: false,
    hasClockInTimeConflict: false,
    hasOverlap: true,
  };
  await rejects(
    createApplication(overlapStore).correct(admin, "attendance-1", {
      expectedVersion: 2,
      clockOutAt: "2026-08-22T02:30:00.000Z",
    }),
    AttendanceTimeOverlapError,
  );
});

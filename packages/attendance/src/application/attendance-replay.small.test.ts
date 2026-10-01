import { deepStrictEqual, throws } from "node:assert/strict";
import test from "node:test";
import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
} from "../domain/attendance.ts";
import type {
  AttendanceEventAppendOptions,
  AttendanceEventStore,
  AttendanceLock,
  StoredAttendanceEvent,
} from "./attendance-event-store.ts";
import {
  replayAttendanceAggregates,
  replayAttendanceCurrentStates,
  replayAttendanceCurrentStatesFromEvents,
  replayAttendanceEventStreams,
} from "./attendance-replay.ts";

class FakeStore implements AttendanceEventStore {
  constructor(private readonly events: readonly StoredAttendanceEvent[]) {}
  async readAll() {
    return this.events;
  }
  async readStream(attendanceId: string) {
    return this.events
      .filter((event) => event.attendanceId === attendanceId)
      .sort((a, b) => a.eventVersion - b.eventVersion);
  }
  async readStreamsByUserId(userId: string) {
    const attendanceIds = new Set(
      this.events
        .filter(
          (event) =>
            event.eventType === "AttendanceClockedIn" &&
            event.payload.userId === userId,
        )
        .map((event) => event.attendanceId),
    );
    return this.events.filter((event) => attendanceIds.has(event.attendanceId));
  }
  async append(
    _events: readonly AttendanceDomainEvent[],
    _options: AttendanceEventAppendOptions,
  ) {
    throw new Error("not implemented");
  }
  async runExclusive<T>(
    _lock: AttendanceLock,
    _operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T> {
    throw new Error("not implemented");
  }
}

function stream(
  attendanceId: string,
  kind: "working" | "completed" | "cancelled",
): StoredAttendanceEvent[] {
  const aggregate = AttendanceAggregate.start(attendanceId);
  const events: AttendanceDomainEvent[] = [
    aggregate.clockIn({
      userId: "user-1",
      workPeriod: "day",
      attendanceDate: "2026-08-22",
      clockInAt: new Date("2026-08-22T09:00:00Z"),
    }),
  ];
  if (kind !== "working")
    events.push(
      aggregate.clockOut({ clockOutAt: new Date("2026-08-22T18:00:00Z") }),
    );
  if (kind === "cancelled") events.push(aggregate.cancel());
  return events.map((event) => ({
    ...event,
    eventId: `${attendanceId}-${event.eventVersion}`,
    performedByUserId: "user-1",
    createdAt: new Date("2026-08-22T00:00:00Z"),
  }));
}

test("通常ReadはAttendanceCancelled済みを除外し、working/completedを含める", async () => {
  const store = new FakeStore([
    ...stream("working", "working"),
    ...stream("completed", "completed"),
    ...stream("cancelled", "cancelled"),
  ]);

  deepStrictEqual(
    (await replayAttendanceCurrentStates(store)).map(
      ({ attendanceId, clockOutAt }) => ({ attendanceId, clockOutAt }),
    ),
    [
      { attendanceId: "working", clockOutAt: null },
      {
        attendanceId: "completed",
        clockOutAt: new Date("2026-08-22T18:00:00Z"),
      },
    ],
  );
});

test("Current State replayは通常取消を除外し、projection再構成では保持する", () => {
  const events = stream("cancelled", "cancelled");

  deepStrictEqual(replayAttendanceCurrentStatesFromEvents(events), []);
  deepStrictEqual(
    replayAttendanceCurrentStatesFromEvents(events, undefined, {
      includeCancelled: true,
    }).map(({ attendanceId, isCancelled }) => ({
      attendanceId,
      isCancelled,
    })),
    [{ attendanceId: "cancelled", isCancelled: true }],
  );
});

test("低レベルのAggregate replayはAttendanceCancelled済みも復元する", async () => {
  const aggregates = await replayAttendanceAggregates(
    new FakeStore(stream("cancelled", "cancelled")),
  );
  deepStrictEqual(
    aggregates.map((aggregate) => ({
      attendanceId: aggregate.attendanceId,
      isCancelled: aggregate.isCancelled,
    })),
    [{ attendanceId: "cancelled", isCancelled: true }],
  );
});

test("複数のattendance streamを入力順でgroupingしてreplayする", () => {
  const firstStream = stream("first", "completed");
  const secondStream = stream("second", "working");
  const events = [firstStream[0], secondStream[0], firstStream[1]] as const;
  const originalEvents = [...events];

  const aggregates = replayAttendanceEventStreams(events);

  deepStrictEqual(
    aggregates.map((aggregate) => ({
      attendanceId: aggregate.attendanceId,
      version: aggregate.version,
      clockOutAt: aggregate.clockOutAt,
    })),
    [
      {
        attendanceId: "first",
        version: 2,
        clockOutAt: new Date("2026-08-22T18:00:00Z"),
      },
      {
        attendanceId: "second",
        version: 1,
        clockOutAt: null,
      },
    ],
  );
  deepStrictEqual(events, originalEvents);
});

test("不正なstreamはAggregate replayのvalidation errorをそのまま返す", () => {
  const [event] = stream("invalid", "working");
  const invalidEvent = { ...event, eventVersion: undefined } as never;

  throws(() => replayAttendanceEventStreams([invalidEvent]));
});

test("replay failure handlerには失敗したstreamのattendanceIdと元errorを渡す", () => {
  const [event] = stream("invalid-handler", "working");
  const invalidEvent = { ...event, eventVersion: undefined } as never;
  let failure: { attendanceId: string; sourceError: unknown } | undefined;

  throws(
    () =>
      replayAttendanceEventStreams([invalidEvent], (attendanceId, error) => {
        failure = { attendanceId, sourceError: error };
        throw new Error("handled replay failure");
      }),
    /handled replay failure/,
  );

  if (failure === undefined) throw new Error("replay failure was not handled");
  deepStrictEqual(failure.attendanceId, "invalid-handler");
  if (!(failure.sourceError instanceof Error))
    throw new Error("the original replay error was not passed to the handler");
});

test("Current State replay failure handlerにもattendanceIdと元errorを渡す", () => {
  const [event] = stream("invalid-current-state", "working");
  const invalidEvent = { ...event, eventVersion: undefined } as never;
  let failure: { attendanceId: string; sourceError: unknown } | undefined;

  throws(
    () =>
      replayAttendanceCurrentStatesFromEvents(
        [invalidEvent],
        (attendanceId, error) => {
          failure = { attendanceId, sourceError: error };
          throw new Error("handled current-state replay failure");
        },
      ),
    /handled current-state replay failure/,
  );

  if (failure === undefined) throw new Error("replay failure was not handled");
  deepStrictEqual(failure.attendanceId, "invalid-current-state");
  if (!(failure.sourceError instanceof Error))
    throw new Error("the original replay error was not passed to the handler");
});

import {
  canManageAttendance,
  canManageTargetUserData,
  type UserAccessStatus,
  type UserRole,
} from "@repo/users";
import type { AttendanceOperationalStatus } from "../domain/attendance.ts";
import {
  AttendanceAggregate,
  calculateWorkedMinutes,
  type WorkPeriod,
} from "../domain/attendance.ts";
import {
  AttendanceCancellationForbiddenError,
  createAttendanceCancellationService,
} from "./attendance-cancellation.ts";
import { createAttendanceClockService } from "./attendance-clock.ts";
import {
  AttendanceCorrectionForbiddenError,
  createAttendanceCorrectionService,
} from "./attendance-correction.ts";
import {
  buildAdminAttendanceDetail,
  toAttendanceEventHistoryItem,
} from "./attendance-detail.ts";
import { summarizeCurrentState } from "./attendance-list.ts";
import { createAttendanceManualCreationService } from "./attendance-manual-creation.ts";
import { createAttendancePayrollProjectionReader } from "./attendance-payroll-projection-reader.ts";
import { replayAttendanceCurrentStates } from "./attendance-replay.ts";
import type {
  AdminAttendanceList,
  AttendanceClockInput,
  AttendanceEventHistoryItem,
  CancelAttendanceInput,
  CorrectAttendanceInput,
  CreateAdminAttendanceInput,
  StaffAttendanceItem,
  StaffCurrentAttendance,
} from "./attendance-types.ts";
import type {
  AttendanceCurrentStateQuery,
  AttendanceCurrentStateReadModel,
} from "./ports/attendance-current-state-read-model.ts";
import type { AttendanceEventStore } from "./ports/attendance-event-store.ts";
import type {
  AttendanceTransactionUnitOfWork,
  AttendanceUserReferenceReader,
} from "./ports/attendance-user-reference.ts";
import { getTokyoDateParts, getTokyoMonthRange } from "./tokyo-date.ts";

export type AttendanceApplicationDependencies = {
  eventStore: AttendanceEventStore;
  currentStateReadModel: AttendanceCurrentStateReadModel;
  userReferences: AttendanceUserReferenceReader;
  transactionUnitOfWork: AttendanceTransactionUnitOfWork;
  now?: () => Date;
};

export type AttendanceApplicationActor = {
  userId: string;
};

export type AttendanceListInput = {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
  userId?: string;
  workPeriod?: WorkPeriod;
  status?: AttendanceOperationalStatus;
};

export class AttendanceEventStreamNotFoundError extends Error {
  constructor() {
    super("Attendance event stream was not found.");
    this.name = "AttendanceEventStreamNotFoundError";
  }
}

export class AttendanceClockProcessingDateMismatchError extends Error {
  constructor() {
    super("打刻日時が処理日の日本時間と一致しません。");
    this.name = "AttendanceClockProcessingDateMismatchError";
  }
}

export class AttendanceManualCreationForbiddenError extends Error {
  constructor() {
    super("You are not allowed to create attendance for another user.");
    this.name = "AttendanceManualCreationForbiddenError";
  }
}

export class AttendanceManualCreationTargetNotFoundError extends Error {
  constructor() {
    super("Target user was not found.");
    this.name = "AttendanceManualCreationTargetNotFoundError";
  }
}

export class AttendanceManualCreationTargetNotApprovedError extends Error {
  constructor() {
    super("Target user has not been approved.");
    this.name = "AttendanceManualCreationTargetNotApprovedError";
  }
}

export class AttendanceAccessForbiddenError extends Error {
  constructor() {
    super("You are not allowed to access this attendance.");
    this.name = "AttendanceAccessForbiddenError";
  }
}

function getAttendanceDateRange(month: string): {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
} {
  const match = /^(?!0000)(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`Invalid year-month: ${month}`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year === 9999 && monthNumber === 12) {
    throw new Error(`Invalid year-month: ${month}`);
  }
  const { startAt, endExclusiveAt } = getTokyoMonthRange(month);
  const startDate = new Date(startAt.getTime() + 9 * 60 * 60 * 1000);
  const endDate = new Date(endExclusiveAt.getTime() - 1 + 9 * 60 * 60 * 1000);
  if (
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime())
  ) {
    throw new Error(`Invalid year-month range: ${month}`);
  }
  const formatDate = (date: Date) =>
    `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  const startAttendanceDateInclusive = formatDate(startDate);
  const endAttendanceDateInclusive = formatDate(endDate);
  return {
    startAttendanceDateInclusive,
    endAttendanceDateInclusive,
  };
}

function compareAttendanceAggregateStates(
  left: { attendanceId: string; clockInAt: Date },
  right: { attendanceId: string; clockInAt: Date },
): number {
  const leftTime = left.clockInAt.getTime();
  const rightTime = right.clockInAt.getTime();
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  return left.attendanceId.localeCompare(right.attendanceId);
}

export function createAttendanceApplication(
  dependencies: AttendanceApplicationDependencies,
) {
  const getStore = () => dependencies.eventStore;
  const currentStateReadModel = dependencies.currentStateReadModel;
  const getCurrentActor = async (
    identity: AttendanceApplicationActor,
    userReader: AttendanceUserReferenceReader = dependencies.userReferences,
  ) => {
    const actor = await userReader.getUserById(identity.userId);
    if (
      !actor ||
      actor.userId !== identity.userId ||
      actor.status !== "active" ||
      (actor.role !== "admin" && actor.role !== "staff")
    ) {
      throw new AttendanceAccessForbiddenError();
    }
    return {
      userId: actor.userId,
      role: actor.role as UserRole,
      status: actor.status as UserAccessStatus,
    };
  };
  const getCurrentAdmin = async (
    identity: AttendanceApplicationActor,
    userReader?: AttendanceUserReferenceReader,
  ) => {
    const actor = await getCurrentActor(identity, userReader);
    if (!canManageAttendance(actor.role, actor.status))
      throw new AttendanceAccessForbiddenError();
    return actor;
  };
  const ensureAttendanceTargetCanBeManaged = async (
    actorUserId: string,
    attendanceId: string,
    forbidden: () => Error,
    eventStore: AttendanceEventStore = getStore(),
    userReader: AttendanceUserReferenceReader = dependencies.userReferences,
    enforceTargetRole = true,
  ) => {
    let authenticatedUser: Awaited<ReturnType<typeof getCurrentAdmin>>;
    try {
      authenticatedUser = await getCurrentAdmin(
        { userId: actorUserId },
        userReader,
      );
    } catch {
      throw forbidden();
    }

    const events = await eventStore.readStream(attendanceId);
    if (events.length === 0) return events;

    const aggregate = AttendanceAggregate.replay(events);
    if (aggregate.userId === null) return events;
    const target = await userReader.getUserById(aggregate.userId);
    if (
      target === null ||
      target.userId !== aggregate.userId ||
      (enforceTargetRole &&
        !canManageTargetUserData(
          authenticatedUser.userId,
          aggregate.userId,
          target.role,
        ))
    ) {
      throw forbidden();
    }
    return events;
  };
  return {
    async getAdminAttendance(
      identity: AttendanceApplicationActor,
      input: AttendanceListInput,
    ): Promise<AdminAttendanceList> {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users: userReader, eventStore }) => {
          await getCurrentAdmin(identity, userReader);
          if (input.userId !== undefined) {
            const target = await userReader.getUserById(input.userId);
            if (!target || target.userId !== input.userId)
              throw new AttendanceAccessForbiddenError();
          }
          const query = {
            startAttendanceDateInclusive: input.startAttendanceDateInclusive,
            endAttendanceDateInclusive: input.endAttendanceDateInclusive,
            userId: input.userId,
            workPeriod: input.workPeriod,
            includeAllCancellationStates: true,
          } satisfies AttendanceCurrentStateQuery;
          const result = await currentStateReadModel.query(query);
          const states =
            result.kind === "ready"
              ? result.states
              : await replayAttendanceCurrentStates(
                  eventStore,
                  input.userId,
                  true,
                );
          const visibleStates = states.filter(
            (state) =>
              state.attendanceDate >= input.startAttendanceDateInclusive &&
              state.attendanceDate <= input.endAttendanceDateInclusive &&
              (!input.userId || state.userId === input.userId) &&
              (!input.workPeriod || state.workPeriod === input.workPeriod),
          );
          const attendances = visibleStates
            .filter(
              (state) =>
                !state.isCancelled &&
                (input.status === undefined ||
                  (input.status === "working"
                    ? state.clockOutAt === null
                    : state.clockOutAt !== null)),
            )
            .sort(
              (left, right) =>
                left.attendanceDate.localeCompare(right.attendanceDate) ||
                left.userId.localeCompare(right.userId) ||
                left.workPeriod.localeCompare(right.workPeriod),
            )
            .map((state) => ({
              attendanceId: state.attendanceId,
              eventVersion: state.eventVersion,
              attendanceDate: state.attendanceDate,
              userId: state.userId,
              workPeriod: state.workPeriod,
              clockInAt: state.clockInAt.toISOString(),
              clockOutAt: state.clockOutAt?.toISOString() ?? null,
              workedMinutes: state.clockOutAt
                ? calculateWorkedMinutes(state.clockInAt, state.clockOutAt)
                : null,
              status:
                state.clockOutAt === null
                  ? ("working" as const)
                  : ("completed" as const),
            }));
          const cancelledAttendances = visibleStates
            .filter((state) => state.isCancelled)
            .sort(
              (left, right) =>
                left.attendanceDate.localeCompare(right.attendanceDate) ||
                left.userId.localeCompare(right.userId) ||
                left.workPeriod.localeCompare(right.workPeriod) ||
                left.clockInAt.getTime() - right.clockInAt.getTime() ||
                left.attendanceId.localeCompare(right.attendanceId),
            )
            .map((state) => ({
              attendanceId: state.attendanceId,
              attendanceDate: state.attendanceDate,
              userId: state.userId,
              workPeriod: state.workPeriod,
              clockInAt: state.clockInAt.toISOString(),
            }));
          return { attendances, cancelledAttendances };
        },
      );
    },

    async getStaffCurrentAttendance(
      identity: AttendanceApplicationActor,
    ): Promise<StaffCurrentAttendance> {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          const actor = await getCurrentActor(identity, users);
          const userId = actor.userId;
          const now = dependencies.now?.() ?? new Date();
          const today = getTokyoDateParts(now);
          const referenceDate = `${today.year}-${today.month}-${today.day}`;
          const result = await currentStateReadModel.query({
            userId,
            attendanceDateOrWorking: referenceDate,
          });
          const states =
            result.kind === "ready"
              ? result.states
              : await replayAttendanceCurrentStates(eventStore, userId);
          const attendances = states
            .filter(
              (state) =>
                state.userId === userId &&
                (state.attendanceDate === referenceDate ||
                  state.clockOutAt === null),
            )
            .sort(compareAttendanceAggregateStates)
            .map((state) => summarizeCurrentState(state));
          return { referenceDate, attendances };
        },
      );
    },

    async getAttendanceHistory(
      identity: AttendanceApplicationActor,
      month: string,
    ): Promise<StaffAttendanceItem[]> {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          const actor = await getCurrentActor(identity, users);
          const userId = actor.userId;
          const { startAttendanceDateInclusive, endAttendanceDateInclusive } =
            getAttendanceDateRange(month);
          const states = (
            await createAttendancePayrollProjectionReader({
              eventStore,
              currentStateReadModel,
            }).getPayrollProjectionStates(
              {
                userId,
                startAttendanceDateInclusive,
                endAttendanceDateInclusive,
              },
              userId,
            )
          ).filter(
            (state) =>
              state.userId === userId &&
              state.attendanceDate >= startAttendanceDateInclusive &&
              state.attendanceDate <= endAttendanceDateInclusive,
          );
          return states
            .sort(
              (left, right) =>
                right.attendanceDate.localeCompare(left.attendanceDate) ||
                compareAttendanceAggregateStates(left, right),
            )
            .map((state) => summarizeCurrentState(state));
        },
      );
    },

    async getAttendanceEventHistory(
      identity: AttendanceApplicationActor,
      attendanceId: string,
    ): Promise<AttendanceEventHistoryItem[]> {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          const events = await ensureAttendanceTargetCanBeManaged(
            identity.userId,
            attendanceId,
            () => new AttendanceAccessForbiddenError(),
            eventStore,
            users,
            false,
          );
          if (events.length === 0)
            throw new AttendanceEventStreamNotFoundError();
          return events.map(toAttendanceEventHistoryItem);
        },
      );
    },

    async getAdminAttendanceDetail(
      identity: AttendanceApplicationActor,
      attendanceId: string,
    ) {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          const events = await ensureAttendanceTargetCanBeManaged(
            identity.userId,
            attendanceId,
            () => new AttendanceAccessForbiddenError(),
            eventStore,
            users,
            false,
          );
          if (events.length === 0)
            throw new AttendanceEventStreamNotFoundError();
          const aggregate = AttendanceAggregate.replay(events);
          return buildAdminAttendanceDetail(
            aggregate,
            events,
            await users.getUsers(),
          );
        },
      );
    },

    async clock(
      authenticatedUser: AttendanceApplicationActor,
      body: AttendanceClockInput,
    ) {
      const now = dependencies.now?.() ?? new Date();
      const today = getTokyoDateParts(now);
      const occurredAt = new Date(body.occurredAt);
      const occurredDate = getTokyoDateParts(occurredAt);
      if (
        occurredDate.year !== today.year ||
        occurredDate.month !== today.month ||
        occurredDate.day !== today.day
      ) {
        throw new AttendanceClockProcessingDateMismatchError();
      }
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          const actor = await getCurrentActor(authenticatedUser, users);
          const service = createAttendanceClockService(eventStore);
          const event =
            body.eventType === "clock_in"
              ? await service.execute({
                  userId: actor.userId,
                  performedByUserId: actor.userId,
                  workPeriod: body.workPeriod,
                  eventType: body.eventType,
                  occurredAt,
                })
              : await service.execute({
                  userId: actor.userId,
                  performedByUserId: actor.userId,
                  workPeriod: body.workPeriod,
                  eventType: body.eventType,
                  occurredAt,
                  targetAttendanceId: body.targetAttendanceId,
                  targetEventVersion: body.targetEventVersion,
                });
          return {
            attendanceId: event.attendanceId,
            workPeriod: body.workPeriod,
            eventType: body.eventType,
            occurredAt: occurredAt.toISOString(),
          };
        },
      );
    },

    async createAdminAttendance(
      authenticatedUser: AttendanceApplicationActor,
      body: CreateAdminAttendanceInput,
    ) {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          let actor: Awaited<ReturnType<typeof getCurrentAdmin>>;
          try {
            actor = await getCurrentAdmin(authenticatedUser, users);
          } catch {
            throw new AttendanceManualCreationForbiddenError();
          }
          const target = await users.getUserById(body.userId);
          if (target === null || target.userId !== body.userId) {
            throw new AttendanceManualCreationTargetNotFoundError();
          }
          if (target.status !== "active" && target.status !== "inactive") {
            throw new AttendanceManualCreationTargetNotApprovedError();
          }
          if (
            !canManageTargetUserData(actor.userId, target.userId, target.role)
          ) {
            throw new AttendanceManualCreationForbiddenError();
          }
          const result = await createAttendanceManualCreationService(
            eventStore,
          ).execute({
            userId: target.userId,
            performedByUserId: actor.userId,
            workPeriod: body.workPeriod,
            clockInAt: new Date(body.clockInAt),
            clockOutAt: new Date(body.clockOutAt),
          });
          return { attendanceId: result.attendanceId };
        },
      );
    },

    async correct(
      authenticatedUser: AttendanceApplicationActor,
      attendanceId: string,
      body: CorrectAttendanceInput,
    ) {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          let actor: Awaited<ReturnType<typeof getCurrentAdmin>>;
          try {
            actor = await getCurrentAdmin(authenticatedUser, users);
          } catch {
            throw new AttendanceCorrectionForbiddenError();
          }
          await ensureAttendanceTargetCanBeManaged(
            actor.userId,
            attendanceId,
            () => new AttendanceCorrectionForbiddenError(),
            eventStore,
            users,
          );
          await createAttendanceCorrectionService(eventStore).execute({
            attendanceId,
            expectedVersion: body.expectedVersion,
            actor: { userId: actor.userId },
            changes: {
              workPeriod: body.workPeriod,
              clockInAt:
                body.clockInAt === undefined
                  ? undefined
                  : new Date(body.clockInAt),
              clockOutAt:
                body.clockOutAt === undefined
                  ? undefined
                  : new Date(body.clockOutAt),
            },
          });
          return { attendanceId };
        },
      );
    },

    async cancel(
      authenticatedUser: AttendanceApplicationActor,
      attendanceId: string,
      body: CancelAttendanceInput,
    ) {
      return dependencies.transactionUnitOfWork.runInTransaction(
        async ({ users, eventStore }) => {
          let actor: Awaited<ReturnType<typeof getCurrentAdmin>>;
          try {
            actor = await getCurrentAdmin(authenticatedUser, users);
          } catch {
            throw new AttendanceCancellationForbiddenError();
          }
          await ensureAttendanceTargetCanBeManaged(
            actor.userId,
            attendanceId,
            () => new AttendanceCancellationForbiddenError(),
            eventStore,
            users,
          );
          await createAttendanceCancellationService(eventStore).execute({
            attendanceId,
            actor: { userId: actor.userId },
            expectedVersion: body.expectedVersion,
          });
          return { attendanceId };
        },
      );
    },
  };
}

import {
  canManageAttendance,
  canManageTargetUserData,
  type UserRole,
  type UserStatus,
} from "@repo/users";
import type { AttendanceListStatus } from "../domain/attendance.ts";
import { AttendanceAggregate, type WorkPeriod } from "../domain/attendance.ts";
import {
  AttendanceCancellationForbiddenError,
  createAttendanceCancellationService,
} from "./attendance-cancellation.ts";
import { createAttendanceClockService } from "./attendance-clock.ts";
import {
  AttendanceCorrectionForbiddenError,
  createAttendanceCorrectionService,
} from "./attendance-correction.ts";
import { aggregateToCurrentState } from "./attendance-current-state.ts";
import type {
  AttendanceCurrentStateQuery,
  AttendanceCurrentStateReadModel,
} from "./attendance-current-state-read-model.ts";
import {
  buildAdminAttendanceDetail,
  toAttendanceEventHistoryItem,
} from "./attendance-detail.ts";
import type { AttendanceEventStore } from "./attendance-event-store.ts";
import {
  buildAttendanceList,
  buildCancelledAttendanceList,
  summarizeCurrentState,
} from "./attendance-list.ts";
import { createAttendanceManualCreationService } from "./attendance-manual-creation.ts";
import {
  replayAttendanceAggregates,
  replayAttendanceCurrentStates,
} from "./attendance-replay.ts";
import type {
  AttendanceEventHistoryItem,
  AttendanceListItem,
  CancelAttendanceInput,
  CancelledAttendanceListItem,
  CorrectAttendanceInput,
  CreateAdminAttendanceInput,
  CreateAttendanceEventInput,
  StaffAttendanceItem,
  StaffCurrentAttendance,
} from "./attendance-types.ts";
import { getTokyoDateParts, getTokyoMonthRange } from "./tokyo-date.ts";

export type AttendanceApplicationDependencies = {
  eventStore: AttendanceEventStore;
  currentStateReadModel: AttendanceCurrentStateReadModel;
  userReferences: AttendanceUserReferenceReader;
  now?: () => Date;
};

type AttendanceUserReferenceReader = {
  getUsers: () => Promise<
    Array<{ userId: string; displayName: string | null }>
  >;
  getUserById: (userId: string) => Promise<{
    userId: string;
    role: string;
    status: string;
  } | null>;
};

export type AttendanceApplicationActor = {
  userId: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
};

export type AttendanceListInput = {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
  userId?: string;
  workPeriod?: WorkPeriod;
  status?: AttendanceListStatus;
};

export type CancelledAttendanceListInput = Pick<
  AttendanceListInput,
  | "startAttendanceDateInclusive"
  | "endAttendanceDateInclusive"
  | "userId"
  | "workPeriod"
>;

export class AttendanceEventStreamNotFoundError extends Error {
  constructor() {
    super("Attendance event stream was not found.");
    this.name = "AttendanceEventStreamNotFoundError";
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

function getAttendanceDateRange(month: string): {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
} {
  const { startAt: monthStart, endExclusiveAt: monthEnd } =
    getTokyoMonthRange(month);
  const startParts = getTokyoDateParts(monthStart);
  const endParts = getTokyoDateParts(new Date(monthEnd.getTime() - 1));
  return {
    startAttendanceDateInclusive: `${startParts.year}-${startParts.month}-${startParts.day}`,
    endAttendanceDateInclusive: `${endParts.year}-${endParts.month}-${endParts.day}`,
  };
}

function compareAttendanceStates(
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
  const getCurrentStates = async (
    query: AttendanceCurrentStateQuery,
    fallbackUserId?: string,
  ) => {
    const result = await currentStateReadModel.query(query);
    if (result.kind === "ready") return result.states;
    return replayAttendanceCurrentStates(getStore(), fallbackUserId);
  };
  const getAttendanceListUsers = () => dependencies.userReferences.getUsers();
  const findUser = (userId: string) =>
    dependencies.userReferences.getUserById(userId);
  const ensureAttendanceTargetCanBeManaged = async (
    authenticatedUser: AttendanceApplicationActor,
    attendanceId: string,
    forbidden: () => Error,
  ) => {
    if (
      !canManageAttendance(authenticatedUser.role, authenticatedUser.status)
    ) {
      throw forbidden();
    }

    const events = await getStore().readStream(attendanceId);
    if (events.length === 0) return;

    const aggregate = AttendanceAggregate.replay(events);
    if (aggregate.userId === null) return;

    const target = await findUser(aggregate.userId);
    if (
      target === null ||
      !canManageTargetUserData(
        authenticatedUser.userId,
        aggregate.userId,
        target.role,
      )
    ) {
      throw forbidden();
    }
  };
  return {
    async getAdminAttendanceList(
      input: AttendanceListInput,
    ): Promise<AttendanceListItem[]> {
      const states = await getCurrentStates(
        {
          startAttendanceDateInclusive: input.startAttendanceDateInclusive,
          endAttendanceDateInclusive: input.endAttendanceDateInclusive,
          userId: input.userId,
          workPeriod: input.workPeriod,
          status: input.status,
        },
        input.userId,
      );
      return buildAttendanceList(states, await getAttendanceListUsers(), input);
    },

    async getAdminCancelledAttendanceList(
      input: CancelledAttendanceListInput,
    ): Promise<CancelledAttendanceListItem[]> {
      const query = {
        startAttendanceDateInclusive: input.startAttendanceDateInclusive,
        endAttendanceDateInclusive: input.endAttendanceDateInclusive,
        userId: input.userId,
        workPeriod: input.workPeriod,
        includeCancelled: true,
      } satisfies AttendanceCurrentStateQuery;
      const result = await currentStateReadModel.query(query);
      const states =
        result.kind === "ready"
          ? result.states
          : (await replayAttendanceAggregates(getStore(), input.userId)).map(
              aggregateToCurrentState,
            );
      return buildCancelledAttendanceList(
        states,
        await getAttendanceListUsers(),
        input,
      );
    },

    async getStaffCurrentAttendance(
      userId: string,
    ): Promise<StaffCurrentAttendance> {
      const now = dependencies.now?.() ?? new Date();
      const today = getTokyoDateParts(now);
      const referenceDate = `${today.year}-${today.month}-${today.day}`;
      const states = await getCurrentStates({ userId }, userId);
      const attendances = states
        .filter(
          (state) =>
            state.userId === userId &&
            (state.attendanceDate === referenceDate ||
              state.clockOutAt === null),
        )
        .sort(compareAttendanceStates)
        .map((state) => summarizeCurrentState(state));
      return {
        referenceDate,
        attendances,
      };
    },

    async getAttendanceHistory(
      userId: string,
      month: string,
    ): Promise<StaffAttendanceItem[]> {
      const { startAttendanceDateInclusive, endAttendanceDateInclusive } =
        getAttendanceDateRange(month);
      const states = (
        await getCurrentStates(
          { userId, startAttendanceDateInclusive, endAttendanceDateInclusive },
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
            compareAttendanceStates(left, right),
        )
        .map((state) => summarizeCurrentState(state));
    },

    getCurrentStates(
      query: AttendanceCurrentStateQuery,
      fallbackUserId?: string,
    ) {
      return getCurrentStates(query, fallbackUserId);
    },

    async getAttendanceEventHistory(
      attendanceId: string,
    ): Promise<AttendanceEventHistoryItem[]> {
      const events = (await getStore().readStream(attendanceId)).map(
        toAttendanceEventHistoryItem,
      );
      if (events.length === 0) throw new AttendanceEventStreamNotFoundError();
      return events;
    },

    async getAdminAttendanceDetail(attendanceId: string) {
      const events = await getStore().readStream(attendanceId);
      if (events.length === 0) throw new AttendanceEventStreamNotFoundError();
      const aggregate = AttendanceAggregate.replay(events);
      return buildAdminAttendanceDetail(
        aggregate,
        events,
        await getAttendanceListUsers(),
      );
    },

    async clock(
      authenticatedUser: AttendanceApplicationActor,
      body: CreateAttendanceEventInput,
    ) {
      const now = dependencies.now?.() ?? new Date();
      const today = getTokyoDateParts(now);
      const occurredAt = new Date(
        `${today.year}-${today.month}-${today.day}T${body.time}:00+09:00`,
      );
      const service = createAttendanceClockService(getStore());
      const event =
        body.eventType === "clock_in"
          ? await service.execute({
              userId: authenticatedUser.userId,
              performedByUserId: authenticatedUser.userId,
              workPeriod: body.workPeriod,
              eventType: body.eventType,
              occurredAt,
            })
          : "targetAttendanceId" in body
            ? await service.execute({
                userId: authenticatedUser.userId,
                performedByUserId: authenticatedUser.userId,
                workPeriod: body.workPeriod,
                eventType: body.eventType,
                occurredAt,
                targetAttendanceId: body.targetAttendanceId,
                targetEventVersion: body.targetEventVersion,
              })
            : await service.execute({
                userId: authenticatedUser.userId,
                performedByUserId: authenticatedUser.userId,
                workPeriod: body.workPeriod,
                eventType: body.eventType,
                occurredAt,
              });
      return {
        attendanceId: event.attendanceId,
        workPeriod: body.workPeriod,
        eventType: body.eventType,
        occurredAt: occurredAt.toISOString(),
      };
    },

    async createAdminAttendance(
      authenticatedUser: AttendanceApplicationActor,
      body: CreateAdminAttendanceInput,
    ) {
      if (
        !canManageAttendance(authenticatedUser.role, authenticatedUser.status)
      ) {
        throw new AttendanceManualCreationForbiddenError();
      }
      const target = await findUser(body.userId);
      if (target === null) {
        throw new AttendanceManualCreationTargetNotFoundError();
      }
      if (target.status !== "active" && target.status !== "inactive") {
        throw new AttendanceManualCreationTargetNotApprovedError();
      }
      if (
        !canManageTargetUserData(
          authenticatedUser.userId,
          target.userId,
          target.role,
        )
      ) {
        throw new AttendanceManualCreationForbiddenError();
      }
      const result = await createAttendanceManualCreationService(
        getStore(),
      ).execute({
        userId: target.userId,
        performedByUserId: authenticatedUser.userId,
        workPeriod: body.workPeriod,
        clockInAt: new Date(body.clockInAt),
        clockOutAt: new Date(body.clockOutAt),
      });
      return { attendanceId: result.attendanceId };
    },

    async correct(
      authenticatedUser: AttendanceApplicationActor,
      attendanceId: string,
      body: CorrectAttendanceInput,
    ) {
      await ensureAttendanceTargetCanBeManaged(
        authenticatedUser,
        attendanceId,
        () => new AttendanceCorrectionForbiddenError(),
      );
      await createAttendanceCorrectionService(getStore()).execute({
        attendanceId,
        expectedVersion: body.expectedVersion,
        actor: {
          userId: authenticatedUser.userId,
          role: authenticatedUser.role,
          status: authenticatedUser.status,
        },
        changes: {
          workPeriod: body.workPeriod,
          clockInAt:
            body.clockInAt === undefined ? undefined : new Date(body.clockInAt),
          clockOutAt:
            body.clockOutAt === undefined
              ? undefined
              : new Date(body.clockOutAt),
        },
      });
      return { attendanceId };
    },

    async cancel(
      authenticatedUser: AttendanceApplicationActor,
      attendanceId: string,
      body: CancelAttendanceInput,
    ) {
      await ensureAttendanceTargetCanBeManaged(
        authenticatedUser,
        attendanceId,
        () => new AttendanceCancellationForbiddenError(),
      );
      await createAttendanceCancellationService(getStore()).execute({
        attendanceId,
        actor: {
          userId: authenticatedUser.userId,
          role: authenticatedUser.role,
          status: authenticatedUser.status,
        },
        expectedVersion: body.expectedVersion,
      });
      return { attendanceId };
    },
  };
}

import { randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import {
  attendanceCurrentStates,
  attendanceEvents,
  hourlyWageRules,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { createAuthenticatedUser } from "./authenticated-user-fixture.ts";
import { setTestBrowserReferenceTime } from "./reference-time.ts";

type WorkPeriod = "day" | "night";

type StaffFixture = {
  userId: string;
  setSessionCookie(context: BrowserContext): Promise<void>;
  eventCount(): Promise<number>;
  events(): Promise<
    Array<{
      attendanceId: string;
      eventType: string;
      eventVersion: number;
      payload: unknown;
    }>
  >;
  seedCompleted(input: {
    workPeriod: WorkPeriod;
    clockInAt: Date;
    clockOutAt: Date;
  }): Promise<string>;
  seedHourlyWage(input: {
    workPeriod: WorkPeriod;
    dayType: "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "holiday";
    hourlyWage: number;
    effectiveFrom: string;
  }): Promise<string>;
  seedWorking(input: {
    workPeriod: WorkPeriod;
    clockInAt: Date;
  }): Promise<string>;
};

type StaffFixtureOptions = {
  staffDisplayName: string | undefined;
  staffFixedNow: string | undefined;
};

async function createStaffFixture(
  displayName?: string,
): Promise<StaffFixture & { cleanup(): Promise<void>; sessionId: string }> {
  const authenticatedUser = await createAuthenticatedUser({
    displayName: displayName ?? `E2Eスタッフ-${randomUUID()}`,
    role: "staff",
    status: "active",
  });
  const { db, userId, sessionId } = authenticatedUser;
  async function seedAttendance(
    workPeriod: WorkPeriod,
    clockInAt: Date,
    clockOutAt?: Date,
  ) {
    const attendanceId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(attendanceEvents).values({
        attendanceId,
        performedByUserId: userId,
        eventVersion: 1,
        eventType: "AttendanceClockedIn",
        payload: {
          userId,
          workPeriod,
          attendanceDate: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
          }).format(clockInAt),
          clockInAt: clockInAt.toISOString(),
        },
      });
      if (clockOutAt) {
        await tx.insert(attendanceEvents).values({
          attendanceId,
          performedByUserId: userId,
          eventVersion: 2,
          eventType: "AttendanceClockedOut",
          payload: { clockOutAt: clockOutAt.toISOString() },
        });
      }
      await tx.insert(attendanceCurrentStates).values({
        attendanceId,
        userId,
        attendanceDate: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tokyo",
        }).format(clockInAt),
        workPeriod,
        clockInAt,
        clockOutAt: clockOutAt ?? null,
        eventVersion: clockOutAt ? 2 : 1,
      });
    });
    return attendanceId;
  }

  return {
    userId,
    sessionId,
    setSessionCookie: authenticatedUser.setSessionCookie,
    async eventCount() {
      const events = await db
        .select({ eventId: attendanceEvents.eventId })
        .from(attendanceEvents)
        .where(eq(attendanceEvents.performedByUserId, userId));
      return events.length;
    },
    async events() {
      return db
        .select({
          attendanceId: attendanceEvents.attendanceId,
          eventType: attendanceEvents.eventType,
          eventVersion: attendanceEvents.eventVersion,
          payload: attendanceEvents.payload,
        })
        .from(attendanceEvents)
        .where(eq(attendanceEvents.performedByUserId, userId));
    },
    async seedWorking({ workPeriod, clockInAt }) {
      return seedAttendance(workPeriod, clockInAt);
    },
    async seedCompleted({ workPeriod, clockInAt, clockOutAt }) {
      return seedAttendance(workPeriod, clockInAt, clockOutAt);
    },
    async seedHourlyWage(input) {
      const [hourlyWageRule] = await db
        .insert(hourlyWageRules)
        .values({ userId, ...input })
        .returning({ id: hourlyWageRules.id });
      if (!hourlyWageRule) throw new Error("Failed to seed hourly wage rule");
      return hourlyWageRule.id;
    },
    async cleanup() {
      try {
        await db
          .delete(attendanceCurrentStates)
          .where(eq(attendanceCurrentStates.userId, userId));
        await db
          .delete(attendanceEvents)
          .where(eq(attendanceEvents.performedByUserId, userId));
      } finally {
        await authenticatedUser.cleanup();
      }
    },
  };
}

export const test = base.extend<StaffFixtureOptions & { staff: StaffFixture }>({
  staffDisplayName: [undefined, { option: true }],
  staffFixedNow: [undefined, { option: true }],
  staff: async ({ page, staffDisplayName, staffFixedNow }, use) => {
    const fixture = await createStaffFixture(staffDisplayName);
    try {
      await fixture.setSessionCookie(page.context());
      await setTestBrowserReferenceTime(page, staffFixedNow);
      // Playwright names its fixture continuation `use`; this is not a React hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use(fixture);
    } finally {
      await fixture.cleanup();
    }
  },
});

export { expect };

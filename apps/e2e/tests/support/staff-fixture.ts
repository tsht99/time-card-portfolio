import { randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { attendanceCurrentStates, attendanceEvents } from "@repo/db";
import { eq } from "drizzle-orm";

import { setE2eBrowserReferenceTime } from "../../reference-time";
import { createAuthenticatedUser } from "./authenticated-user-fixture";

type WorkPeriod = "day" | "night";

type StaffFixture = {
  userId: string;
  setSessionCookie(context: BrowserContext): Promise<void>;
  eventCount(): Promise<number>;
  events(): Promise<
    Array<{ attendanceId: string; eventType: string; eventVersion: number }>
  >;
  seedCompleted(input: {
    workPeriod: WorkPeriod;
    clockInAt: Date;
    clockOutAt: Date;
  }): Promise<string>;
  seedWorking(input: {
    workPeriod: WorkPeriod;
    clockInAt: Date;
  }): Promise<string>;
};

async function createStaffFixture(): Promise<
  StaffFixture & { cleanup(): Promise<void>; sessionId: string }
> {
  const authenticatedUser = await createAuthenticatedUser({
    displayName: `E2Eスタッフ-${randomUUID()}`,
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

export const test = base.extend<{ staff: StaffFixture }>({
  staff: async ({ page }, use) => {
    const fixture = await createStaffFixture();
    try {
      await fixture.setSessionCookie(page.context());
      await setE2eBrowserReferenceTime(page);
      await use(fixture);
    } finally {
      await fixture.cleanup();
    }
  },
});

export { expect };

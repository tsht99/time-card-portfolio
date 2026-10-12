import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import {
  attendanceCurrentStates,
  attendanceEvents,
  authSessions,
  hourlyWageRules,
  users,
} from "@repo/db";
import { eq } from "drizzle-orm";

import { openTestDatabase } from "./database.ts";

const appUrl = "http://127.0.0.1:4173";

type UserInsert = typeof users.$inferInsert;

type AuthenticatedUserInput = {
  role: NonNullable<UserInsert["role"]>;
  displayName: string;
  status: NonNullable<UserInsert["status"]>;
  userId?: string;
};

export async function createAuthenticatedUser({
  role,
  displayName,
  status,
  userId: requestedUserId,
}: AuthenticatedUserInput) {
  const { db, close } = await openTestDatabase();
  const userId = requestedUserId ?? randomUUID();
  const sessionRecordId = randomUUID();
  const sessionId = randomBytes(32).toString("base64url");
  const credentialHash = createHash("sha256").update(sessionId).digest("hex");
  let closed = false;
  let ownsUser = false;

  const closeDatabase = async () => {
    if (closed) return;
    closed = true;
    await close();
  };
  const deleteUserData = async () => {
    try {
      await db.delete(authSessions).where(eq(authSessions.id, sessionRecordId));
    } finally {
      try {
        await db
          .delete(hourlyWageRules)
          .where(eq(hourlyWageRules.userId, userId));
      } finally {
        try {
          await db
            .delete(attendanceCurrentStates)
            .where(eq(attendanceCurrentStates.userId, userId));
        } finally {
          try {
            await db
              .delete(attendanceEvents)
              .where(eq(attendanceEvents.performedByUserId, userId));
          } finally {
            await db.delete(users).where(eq(users.id, userId));
          }
        }
      }
    }
  };

  try {
    await db.insert(users).values({
      id: userId,
      lineUserId: `e2e-${randomUUID()}`,
      displayName,
      role,
      status,
    });
    ownsUser = true;

    await db.insert(authSessions).values({
      id: sessionRecordId,
      credentialHash,
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      revokedAt: null,
    });
  } catch (error) {
    try {
      if (ownsUser) await deleteUserData();
    } finally {
      await closeDatabase();
    }
    throw error;
  }

  return {
    db,
    userId,
    sessionId,
    async setSessionCookie(context: BrowserContext) {
      await context.addCookies([
        {
          name: "timecard_session",
          value: sessionId,
          url: appUrl,
        },
      ]);
    },
    async cleanup() {
      try {
        await deleteUserData();
      } finally {
        await closeDatabase();
      }
    },
  };
}

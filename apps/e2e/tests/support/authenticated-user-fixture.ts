import { randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";
import {
  attendanceCurrentStates,
  attendanceEvents,
  authSessions,
  users,
} from "@repo/db";
import { eq } from "drizzle-orm";

import { openE2eDatabase } from "./database";

const appUrl = "http://127.0.0.1:4173";

type UserInsert = typeof users.$inferInsert;

type AuthenticatedUserInput = {
  role: NonNullable<UserInsert["role"]>;
  displayName: string;
  status: NonNullable<UserInsert["status"]>;
};

export async function createAuthenticatedUser({
  role,
  displayName,
  status,
}: AuthenticatedUserInput) {
  const { db, close } = await openE2eDatabase();
  const userId = randomUUID();
  const sessionId = randomUUID();
  let closed = false;

  const closeDatabase = async () => {
    if (closed) return;
    closed = true;
    await close();
  };

  try {
    await db.insert(users).values({
      id: userId,
      lineUserId: `e2e-${randomUUID()}`,
      displayName,
      role,
      status,
    });

    await db.insert(authSessions).values({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      revokedAt: null,
    });
  } catch (error) {
    try {
      try {
        await db.delete(authSessions).where(eq(authSessions.id, sessionId));
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
        try {
          await db.delete(authSessions).where(eq(authSessions.id, sessionId));
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
      } finally {
        await closeDatabase();
      }
    },
  };
}

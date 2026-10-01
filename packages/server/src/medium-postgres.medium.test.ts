import assert from "node:assert/strict";
import test from "node:test";

import {
  attendanceEvents,
  authSessions,
  hourlyWageRates,
  users,
} from "@repo/db";
import { startMediumTestDatabase } from "./test/medium-postgres.ts";

test("既存migrationで主要テーブルを構築してDrizzleからアクセスできる", async () => {
  const database = await startMediumTestDatabase();

  try {
    assert.deepEqual(await database.db.select().from(users), []);
    assert.deepEqual(await database.db.select().from(authSessions), []);
    assert.deepEqual(await database.db.select().from(attendanceEvents), []);
    assert.deepEqual(await database.db.select().from(hourlyWageRates), []);
  } finally {
    await database.close();
  }
});

test("test databaseごとにapplication dataを分離する", async () => {
  const firstDatabase = await startMediumTestDatabase();

  try {
    await firstDatabase.db.insert(users).values({
      lineUserId: "medium-database-isolation-user",
    });
  } finally {
    await firstDatabase.close();
  }

  const secondDatabase = await startMediumTestDatabase();
  try {
    assert.deepEqual(await secondDatabase.db.select().from(users), []);
  } finally {
    await secondDatabase.close();
  }
});

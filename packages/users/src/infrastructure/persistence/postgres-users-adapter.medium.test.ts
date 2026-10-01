import assert from "node:assert/strict";
// cspell:ignore btrim constraintdef indexdef
// cspell:ignore datname conname
import test from "node:test";
import { eq } from "drizzle-orm";

import { createAuthenticationApplication } from "../../application/authentication.ts";
import { createUserManagementApplication } from "../../application/user-management.ts";
import { authSessions } from "../../schema/auth-sessions.ts";
import { users } from "../../schema/users.ts";
import { startMediumTestDatabase } from "../../test/medium-postgres.ts";
import { createPostgresUsersAdapter } from "./postgres-users-adapter.ts";

const sessionIdPattern = /^[0-9a-f-]{36}$/i;

async function waitForRowLock(
  pool: Awaited<ReturnType<typeof startMediumTestDatabase>>["pool"],
) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const result = await pool.query<{ waiting: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      ) AS waiting
    `);
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for users row lock.");
}

test("schema composition keeps enum, defaults, checks, indexes and session foreign key", async () => {
  const database = await startMediumTestDatabase();
  try {
    const [{ id }] = await database.db
      .insert(users)
      .values({ lineUserId: "schema-user" })
      .returning({ id: users.id });
    assert.ok(id);
    const [row] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, id));
    assert.equal(row?.role, "staff");
    assert.equal(row?.status, "pending");
    const constraints = await database.pool.query<{
      conname: string;
      definition: string;
    }>(`
      SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname IN (
        'users_staff_active_inactive_display_name_required_check',
        'users_display_name_length_check',
        'auth_sessions_user_id_users_id_fk'
      )
    `);
    assert.deepEqual(constraints.rows.map((row) => row.conname).sort(), [
      "auth_sessions_user_id_users_id_fk",
      "users_display_name_length_check",
      "users_staff_active_inactive_display_name_required_check",
    ]);
    const displayNameChecks = constraints.rows.filter(
      (row) =>
        row.conname.startsWith("users_") && row.conname.endsWith("_check"),
    );
    assert.equal(displayNameChecks.length, 2);
    for (const { definition } of displayNameChecks) {
      assert.doesNotMatch(definition, /trim|btrim|regexp|chr\s*\(/i);
    }
    assert.match(
      displayNameChecks.find(
        (row) => row.conname === "users_display_name_length_check",
      )?.definition ?? "",
      /char_length\(display_name\).*>= 1.*char_length\(display_name\).*<= 100/i,
    );
    assert.match(
      displayNameChecks.find(
        (row) =>
          row.conname ===
          "users_staff_active_inactive_display_name_required_check",
      )?.definition ?? "",
      /display_name.*is not null/i,
    );
    const index = await database.pool.query<{
      indexname: string;
      indexdef: string;
    }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname = 'users_active_inactive_display_name_unique'
    `);
    assert.equal(index.rows.length, 1);
    assert.match(index.rows[0]?.indexdef ?? "", /unique.*display_name/i);
    assert.match(index.rows[0]?.indexdef ?? "", /active.*inactive/i);
  } finally {
    await database.close();
  }
});

test("PostgreSQL の長さ制約は100絵文字を許し101絵文字を拒否する", async () => {
  const database = await startMediumTestDatabase();
  try {
    await database.db.insert(users).values({
      lineUserId: "length-100",
      displayName: "😀".repeat(100),
    });
    await database.db.insert(users).values({
      lineUserId: "db-keeps-content-check-in-domain",
      displayName: "\u00a0",
      status: "active",
    });
    await assert.rejects(
      database.db.insert(users).values({
        lineUserId: "length-101",
        displayName: "😀".repeat(101),
      }),
      (error: unknown) => {
        let cause: unknown = error;
        while (cause instanceof Error) {
          if (
            "constraint" in cause &&
            cause.constraint === "users_display_name_length_check"
          )
            return true;
          cause = "cause" in cause ? cause.cause : null;
        }
        return false;
      },
    );
  } finally {
    await database.close();
  }
});

test("初回 LINE 値を保ち、inactive 化で session を失効し active 復帰でも復活しない", async () => {
  const database = await startMediumTestDatabase();
  try {
    const adapter = createPostgresUsersAdapter(database.db, {
      sessionTtlHours: 24,
    });
    let lineDisplayName = "  LINE 表示名  ";
    const authentication = createAuthenticationApplication({
      line: {
        verifyIdToken: async () => ({
          ok: true,
          lineUserId: "line-user",
          displayName: lineDisplayName,
        }),
        verifyAccessToken: async () => {
          throw new Error("unused");
        },
      },
      users: adapter,
      sessions: adapter,
      unitOfWork: adapter,
    });
    const first = await authentication.authenticateWithLine({
      idToken: "token",
    });
    assert.deepEqual(first, {
      ok: false,
      code: "USER_PENDING",
      message: "管理者の承認待ちです。",
    });
    const [registered] = await database.db.select().from(users);
    assert.equal(registered?.displayName, "LINE 表示名");
    assert.equal(registered?.status, "pending");
    assert.ok(registered);

    const management = createUserManagementApplication(adapter, adapter);
    assert.deepEqual(
      await management.updateUserStatus({
        userId: registered.id,
        status: "active",
      }),
      { kind: "success", userId: registered.id, status: "active" },
    );
    lineDisplayName = "変更されたLINE名";
    const loggedIn = await authentication.authenticateWithLine({
      idToken: "token",
    });
    assert.equal(loggedIn.ok, true);
    if (!loggedIn.ok) throw new Error("Expected a session.");
    assert.match(loggedIn.sessionId, sessionIdPattern);
    assert.deepEqual(
      await authentication.resolveActiveSession(loggedIn.sessionId),
      {
        ok: true,
        user: {
          userId: registered.id,
          displayName: "LINE 表示名",
          role: "staff",
          status: "active",
        },
      },
    );

    assert.deepEqual(
      await management.updateUserStatus({
        userId: registered.id,
        status: "inactive",
      }),
      { kind: "success", userId: registered.id, status: "inactive" },
    );
    assert.deepEqual(
      await management.updateUserStatus({
        userId: registered.id,
        status: "active",
      }),
      { kind: "success", userId: registered.id, status: "active" },
    );
    assert.deepEqual(
      await authentication.resolveActiveSession(loggedIn.sessionId),
      {
        ok: false,
        code: "SESSION_EXPIRED",
      },
    );
    const [session] = await database.db
      .select({ revokedAt: authSessions.revokedAt })
      .from(authSessions)
      .where(eq(authSessions.id, loggedIn.sessionId));
    assert.ok(session?.revokedAt);
  } finally {
    await database.close();
  }
});

test("status transition は row lock 後の最新状態で判断する", async () => {
  const database = await startMediumTestDatabase();
  const lockClient = await database.pool.connect();
  try {
    const [{ id }] = await database.db
      .insert(users)
      .values({ lineUserId: "lock-user", displayName: "ロック利用者" })
      .returning({ id: users.id });
    assert.ok(id);
    const adapter = createPostgresUsersAdapter(database.db, {
      sessionTtlHours: 24,
    });
    await lockClient.query("BEGIN");
    await lockClient.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
      id,
    ]);
    await lockClient.query("UPDATE users SET status = 'active' WHERE id = $1", [
      id,
    ]);
    const update = createUserManagementApplication(
      adapter,
      adapter,
    ).updateUserStatus({ userId: id, status: "inactive" });
    await waitForRowLock(database.pool);
    await lockClient.query("COMMIT");
    assert.deepEqual(await update, {
      kind: "success",
      userId: id,
      status: "inactive",
    });
  } finally {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    lockClient.release();
    await database.close();
  }
});

test("login と inactive 化が競合しても確定後の status で session 発行を拒否する", async () => {
  const database = await startMediumTestDatabase();
  const lockClient = await database.pool.connect();
  try {
    const [{ id }] = await database.db
      .insert(users)
      .values({
        lineUserId: "login-race",
        displayName: "競合利用者",
        status: "active",
      })
      .returning({ id: users.id });
    assert.ok(id);
    const adapter = createPostgresUsersAdapter(database.db, {
      sessionTtlHours: 24,
    });
    const authentication = createAuthenticationApplication({
      line: {
        verifyIdToken: async () => ({
          ok: true,
          lineUserId: "login-race",
          displayName: "新しい LINE 名",
        }),
        verifyAccessToken: async () => {
          throw new Error("unused");
        },
      },
      users: adapter,
      sessions: adapter,
      unitOfWork: adapter,
    });

    await lockClient.query("BEGIN");
    await lockClient.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
      id,
    ]);
    await lockClient.query(
      "UPDATE users SET status = 'inactive' WHERE id = $1",
      [id],
    );
    const login = authentication.authenticateWithLine({ idToken: "token" });
    await waitForRowLock(database.pool);
    await lockClient.query("COMMIT");
    assert.deepEqual(await login, {
      ok: false,
      code: "USER_INACTIVE",
      message: "このユーザーは利用停止中です。",
    });
    const existingSessions = await database.db.select().from(authSessions);
    assert.equal(existingSessions.length, 0);
  } finally {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    lockClient.release();
    await database.close();
  }
});

test("session 発行が先に lock した場合も inactive 化は発行済み session を失効する", async () => {
  const database = await startMediumTestDatabase();
  let releaseSession: () => void = () => {};
  try {
    const [{ id }] = await database.db
      .insert(users)
      .values({
        lineUserId: "session-first-race",
        displayName: "先行ログイン利用者",
        status: "active",
      })
      .returning({ id: users.id });
    assert.ok(id);
    const adapter = createPostgresUsersAdapter(database.db, {
      sessionTtlHours: 24,
    });
    let signalLocked: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    const issued = adapter.run(async (transaction) => {
      const user = await transaction.lockUser(id);
      assert.equal(user?.status, "active");
      signalLocked();
      await held;
      return transaction.issueSession(id);
    });
    await locked;
    const inactivate = createUserManagementApplication(
      adapter,
      adapter,
    ).updateUserStatus({ userId: id, status: "inactive" });
    await waitForRowLock(database.pool);
    releaseSession();
    const issuedResult = await issued;
    assert.equal(issuedResult.ok, true);
    if (!issuedResult.ok) throw new Error("Expected a session.");
    assert.equal((await inactivate).kind, "success");
    const session = await adapter.findSessionById(issuedResult.value.sessionId);
    assert.ok(session?.revokedAt);
    assert.equal(session.user.status, "inactive");
  } finally {
    releaseSession();
    await database.close();
  }
});

test("表示名の一意性競合を変換し、pending の同名は許可する", async () => {
  const database = await startMediumTestDatabase();
  try {
    const inserted = await database.db
      .insert(users)
      .values([
        { lineUserId: "name-a", displayName: "同名" },
        { lineUserId: "name-b", displayName: "同名" },
      ])
      .returning({ id: users.id });
    const firstId = inserted[0]?.id;
    const secondId = inserted[1]?.id;
    assert.ok(firstId);
    assert.ok(secondId);
    const adapter = createPostgresUsersAdapter(database.db, {
      sessionTtlHours: 24,
    });
    const management = createUserManagementApplication(adapter, adapter);
    const results = await Promise.all([
      management.updateUserStatus({ userId: firstId, status: "active" }),
      management.updateUserStatus({ userId: secondId, status: "active" }),
    ]);
    assert.deepEqual(results.map((result) => result.kind).sort(), [
      "display-name-conflict",
      "success",
    ]);
  } finally {
    await database.close();
  }
});

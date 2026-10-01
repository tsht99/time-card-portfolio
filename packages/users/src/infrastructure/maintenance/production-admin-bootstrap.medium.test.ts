import assert from "node:assert/strict";
import test from "node:test";

import type { PostgresDatabase } from "@repo/platform";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { users } from "../../schema/users.ts";
import { startMediumTestDatabase } from "../../test/medium-postgres.ts";
import {
  type ProductionAdminBootstrapResult,
  runProductionAdminBootstrap,
} from "./production-admin-bootstrap.ts";

type TestDatabase = Awaited<ReturnType<typeof startMediumTestDatabase>>;

async function bootstrap(
  database: TestDatabase,
  lineUserId: string,
  apply: boolean,
  databaseName?: string,
): Promise<ProductionAdminBootstrapResult> {
  const client = await database.pool.connect();
  const currentDatabase = (
    await client.query<{ database_name: string }>(
      "select current_database() as database_name",
    )
  ).rows[0].database_name;
  const url = new URL(process.env.TIME_CARD_MEDIUM_POSTGRES_TEMPLATE_URL ?? "");
  const db = drizzle(client, { schema: { users } }) satisfies PostgresDatabase;

  return runProductionAdminBootstrap(
    client,
    db,
    { host: url.hostname, database: databaseName ?? currentDatabase },
    { lineUserId, apply },
  );
}

async function withDatabase<T>(fn: (database: TestDatabase) => Promise<T>) {
  const database = await startMediumTestDatabase();
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

test("dry-run reports eligibility without changing the user", async () => {
  await withDatabase(async (database) => {
    await database.db.insert(users).values({ lineUserId: "bootstrap-dry-run" });

    const result = await bootstrap(database, "bootstrap-dry-run", false);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.action, "update");
    assert.equal(result.canApply, true);
    assert.deepEqual(
      await database.db
        .select({ role: users.role, status: users.status })
        .from(users),
      [{ role: "staff", status: "pending" }],
    );
  });
});

test("only staff pending with no active admin is promoted", async () => {
  await withDatabase(async (database) => {
    await database.db
      .insert(users)
      .values({ lineUserId: "bootstrap-eligible" });

    const result = await bootstrap(database, "bootstrap-eligible", true);
    assert.equal(result.action, "update");
    assert.deepEqual(
      await database.db
        .select({ role: users.role, status: users.status })
        .from(users),
      [{ role: "admin", status: "active" }],
    );
  });
});

test("missing target, unexpected state, and an existing active admin do not update", async () => {
  await withDatabase(async (database) => {
    await assert.rejects(
      bootstrap(database, "bootstrap-missing", true),
      /preconditions are not satisfied/,
    );

    await database.db.insert(users).values([
      {
        lineUserId: "bootstrap-active-staff",
        displayName: "Bootstrap Active Staff",
        status: "active",
      },
      {
        lineUserId: "bootstrap-existing-admin",
        role: "admin",
        status: "active",
      },
      { lineUserId: "bootstrap-existing-admin-target" },
    ]);
    await assert.rejects(
      bootstrap(database, "bootstrap-active-staff", true),
      /preconditions are not satisfied/,
    );
    await assert.rejects(
      bootstrap(database, "bootstrap-existing-admin-target", true),
      /preconditions are not satisfied/,
    );

    assert.deepEqual(
      await database.db
        .select({
          lineUserId: users.lineUserId,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .orderBy(asc(users.lineUserId)),
      [
        {
          lineUserId: "bootstrap-active-staff",
          role: "staff",
          status: "active",
        },
        {
          lineUserId: "bootstrap-existing-admin",
          role: "admin",
          status: "active",
        },
        {
          lineUserId: "bootstrap-existing-admin-target",
          role: "staff",
          status: "pending",
        },
      ],
    );
  });
});

test("all non-pending staff and non-active admin states are blocked", async () => {
  await withDatabase(async (database) => {
    await database.db.insert(users).values([
      {
        lineUserId: "bootstrap-inactive-staff",
        displayName: "Bootstrap Inactive Staff",
        status: "inactive",
      },
      {
        lineUserId: "bootstrap-pending-admin",
        role: "admin",
        status: "pending",
      },
      {
        lineUserId: "bootstrap-inactive-admin",
        role: "admin",
        status: "inactive",
      },
    ]);

    for (const lineUserId of [
      "bootstrap-inactive-staff",
      "bootstrap-pending-admin",
      "bootstrap-inactive-admin",
    ]) {
      await assert.rejects(
        bootstrap(database, lineUserId, true),
        /preconditions are not satisfied/,
      );
    }

    assert.deepEqual(
      await database.db
        .select({
          lineUserId: users.lineUserId,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .orderBy(asc(users.lineUserId)),
      [
        {
          lineUserId: "bootstrap-inactive-admin",
          role: "admin",
          status: "inactive",
        },
        {
          lineUserId: "bootstrap-inactive-staff",
          role: "staff",
          status: "inactive",
        },
        {
          lineUserId: "bootstrap-pending-admin",
          role: "admin",
          status: "pending",
        },
      ],
    );
  });
});

test("already-admin rerun is a no-op and does not change another user", async () => {
  await withDatabase(async (database) => {
    await database.db
      .insert(users)
      .values([
        { lineUserId: "bootstrap-rerun" },
        { lineUserId: "bootstrap-other" },
      ]);

    const first = await bootstrap(database, "bootstrap-rerun", true);
    const second = await bootstrap(database, "bootstrap-rerun", true);
    assert.equal(first.action, "update");
    assert.equal(second.action, "no-op");
    assert.deepEqual(
      await database.db
        .select({
          lineUserId: users.lineUserId,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .orderBy(asc(users.lineUserId)),
      [
        {
          lineUserId: "bootstrap-other",
          role: "staff",
          status: "pending",
        },
        {
          lineUserId: "bootstrap-rerun",
          role: "admin",
          status: "active",
        },
      ],
    );
  });
});

test("concurrent applies are serialized and only one bootstrap updates", async () => {
  await withDatabase(async (database) => {
    await database.db
      .insert(users)
      .values({ lineUserId: "bootstrap-concurrent" });

    const results = await Promise.all([
      bootstrap(database, "bootstrap-concurrent", true),
      bootstrap(database, "bootstrap-concurrent", true),
    ]);
    assert.deepEqual(results.map((result) => result.action).sort(), [
      "no-op",
      "update",
    ]);
    assert.deepEqual(
      await database.db
        .select({ role: users.role, status: users.status })
        .from(users),
      [{ role: "admin", status: "active" }],
    );
  });
});

test("current_database mismatch is rejected before any update", async () => {
  await withDatabase(async (database) => {
    await database.db
      .insert(users)
      .values({ lineUserId: "bootstrap-identity" });
    await assert.rejects(
      bootstrap(database, "bootstrap-identity", true, "unexpected-database"),
      /Connected database does not match/,
    );
    assert.deepEqual(
      await database.db
        .select({ role: users.role, status: users.status })
        .from(users),
      [{ role: "staff", status: "pending" }],
    );
  });
});

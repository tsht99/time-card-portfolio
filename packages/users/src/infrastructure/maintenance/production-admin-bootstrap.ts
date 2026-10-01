import { createHash } from "node:crypto";

import type { PostgresDatabase } from "@repo/platform";
import { and, eq, sql } from "drizzle-orm";

import { users } from "../../schema/users.ts";

const PRODUCTION_ADMIN_BOOTSTRAP_LOCK_KEY = 1_907_311_847;

type UserRole = "admin" | "staff";
type UserStatus = "active" | "inactive" | "pending";

type BootstrapUser = {
  userId: string;
  lineUserId: string;
  role: UserRole;
  status: UserStatus;
};

type BootstrapInspection = {
  targetCount: number;
  target: BootstrapUser | undefined;
  activeAdminCount: number;
  action: "update" | "no-op" | "blocked";
  reason:
    | "target-not-found"
    | "multiple-targets"
    | "target-already-admin"
    | "target-not-pending-staff"
    | "active-admin-exists"
    | "eligible";
};

export type ProductionAdminBootstrapOptions = {
  lineUserId: string;
  apply: boolean;
};

export type ProductionAdminBootstrapDatabaseIdentity = {
  host: string;
  database: string;
};

export type ProductionAdminBootstrapResult = {
  mode: "dry-run" | "apply";
  database: ProductionAdminBootstrapDatabaseIdentity;
  targetCount: number;
  target:
    | {
        userId: string;
        lineUserIdFingerprint: string;
        role: UserRole;
        status: UserStatus;
      }
    | undefined;
  activeAdminCount: number;
  action: "update" | "no-op" | "blocked";
  canApply: boolean;
  reason: BootstrapInspection["reason"];
};

class ProductionAdminBootstrapError extends Error {}

function fingerprintLineUserId(lineUserId: string): string {
  return createHash("sha256").update(lineUserId).digest("hex").slice(0, 16);
}

function toResult(
  mode: "dry-run" | "apply",
  database: ProductionAdminBootstrapDatabaseIdentity,
  inspection: BootstrapInspection,
): ProductionAdminBootstrapResult {
  return {
    mode,
    database,
    targetCount: inspection.targetCount,
    target: inspection.target
      ? {
          userId: inspection.target.userId,
          lineUserIdFingerprint: fingerprintLineUserId(
            inspection.target.lineUserId,
          ),
          role: inspection.target.role,
          status: inspection.target.status,
        }
      : undefined,
    activeAdminCount: inspection.activeAdminCount,
    action: inspection.action,
    canApply: inspection.action !== "blocked",
    reason: inspection.reason,
  };
}

async function inspectBootstrapTarget(
  db: PostgresDatabase,
  lineUserId: string,
): Promise<BootstrapInspection> {
  const targetRows = await db
    .select({
      userId: users.id,
      lineUserId: users.lineUserId,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.lineUserId, lineUserId));

  const [{ count: activeAdminCount }] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));

  if (targetRows.length === 0) {
    return {
      targetCount: 0,
      target: undefined,
      activeAdminCount,
      action: "blocked",
      reason: "target-not-found",
    };
  }

  if (targetRows.length !== 1) {
    return {
      targetCount: targetRows.length,
      target: undefined,
      activeAdminCount,
      action: "blocked",
      reason: "multiple-targets",
    };
  }

  const target = targetRows[0];
  if (target.role === "admin" && target.status === "active") {
    return {
      targetCount: 1,
      target,
      activeAdminCount,
      action: "no-op",
      reason: "target-already-admin",
    };
  }

  if (target.role !== "staff" || target.status !== "pending") {
    return {
      targetCount: 1,
      target,
      activeAdminCount,
      action: "blocked",
      reason: "target-not-pending-staff",
    };
  }

  if (activeAdminCount !== 0) {
    return {
      targetCount: 1,
      target,
      activeAdminCount,
      action: "blocked",
      reason: "active-admin-exists",
    };
  }

  return {
    targetCount: 1,
    target,
    activeAdminCount,
    action: "update",
    reason: "eligible",
  };
}

async function verifyTargetIsAdmin(db: PostgresDatabase, userId: string) {
  const [target] = await db
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  if (target?.role !== "admin" || target.status !== "active") {
    throw new ProductionAdminBootstrapError(
      "Production admin bootstrap did not complete the expected state transition.",
    );
  }
}

export async function runProductionAdminBootstrap(
  client: {
    query: (
      query: string,
    ) => Promise<{ rows: Array<{ database_name: string }> }>;
    release: () => void;
  },
  database: PostgresDatabase,
  identity: ProductionAdminBootstrapDatabaseIdentity,
  options: ProductionAdminBootstrapOptions,
): Promise<ProductionAdminBootstrapResult> {
  try {
    const databaseResult = await client.query(
      "select current_database() as database_name",
    );
    const currentDatabase = databaseResult.rows[0]?.database_name;
    if (currentDatabase !== identity.database) {
      throw new ProductionAdminBootstrapError(
        "Connected database does not match the expected database.",
      );
    }

    if (!options.apply) {
      const inspection = await inspectBootstrapTarget(
        database,
        options.lineUserId,
      );
      return toResult("dry-run", identity, inspection);
    }

    return await database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PRODUCTION_ADMIN_BOOTSTRAP_LOCK_KEY})`,
      );

      const inspection = await inspectBootstrapTarget(tx, options.lineUserId);
      if (inspection.action === "no-op") {
        return toResult("apply", identity, inspection);
      }
      if (inspection.action === "blocked" || inspection.target === undefined) {
        throw new ProductionAdminBootstrapError(
          "Production admin bootstrap preconditions are not satisfied.",
        );
      }

      const updated = await tx
        .update(users)
        .set({ role: "admin", status: "active" })
        .where(
          and(
            eq(users.id, inspection.target.userId),
            eq(users.role, "staff"),
            eq(users.status, "pending"),
          ),
        )
        .returning({ userId: users.id });
      if (updated.length !== 1) {
        throw new ProductionAdminBootstrapError(
          "Production admin bootstrap updated an unexpected number of users.",
        );
      }

      await verifyTargetIsAdmin(tx, inspection.target.userId);
      return toResult("apply", identity, {
        ...inspection,
        target: { ...inspection.target, role: "admin", status: "active" },
        action: "update",
      });
    });
  } finally {
    client.release();
  }
}

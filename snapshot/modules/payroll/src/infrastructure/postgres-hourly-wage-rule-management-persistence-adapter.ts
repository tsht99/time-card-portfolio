import type { PostgresDatabase } from "@repo/postgres";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  HourlyWageRuleManagementPersistencePort,
  HourlyWageRuleManagementRecord,
} from "../application/ports/hourly-wage-rule-ports.ts";
import type { HourlyWageRule } from "../domain/hourly-wage-rule.ts";
import { hourlyWageRules } from "../schema/hourly-wage-rules.ts";
import { hasDatabaseErrorCode } from "./postgres-error.ts";

type HourlyWageTransaction = Parameters<
  Parameters<PostgresDatabase["transaction"]>[0]
>[0];

function toManagementRecord(
  row: typeof hourlyWageRules.$inferSelect,
): HourlyWageRuleManagementRecord {
  return {
    id: row.id,
    userId: row.userId,
    workPeriod: row.workPeriod as HourlyWageRule["workPeriod"],
    dayType: row.dayType as HourlyWageRule["dayType"],
    hourlyWage: row.hourlyWage,
    effectiveFrom: row.effectiveFrom,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

async function lockHourlyWageRulesForUser(
  tx: HourlyWageTransaction,
  userId: string,
): Promise<void> {
  // cspell:ignore hashtextextended
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
  );
}

function isBulkConflict(error: unknown): boolean {
  return ["23505", "BULK_CONFLICT"].some((code) =>
    hasDatabaseErrorCode(error, code),
  );
}

export class PostgresHourlyWageRuleManagementPersistenceAdapter
  implements HourlyWageRuleManagementPersistencePort
{
  constructor(
    private readonly db: PostgresDatabase | HourlyWageTransaction,
    private readonly transactionContext = false,
  ) {}

  private transaction<T>(operation: (tx: HourlyWageTransaction) => Promise<T>) {
    return this.transactionContext
      ? operation(this.db as HourlyWageTransaction)
      : (this.db as PostgresDatabase).transaction(operation);
  }

  async findAllForUser(userId: string) {
    const rows = await this.db
      .select()
      .from(hourlyWageRules)
      .where(eq(hourlyWageRules.userId, userId))
      .orderBy(
        asc(hourlyWageRules.workPeriod),
        asc(hourlyWageRules.dayType),
        asc(hourlyWageRules.effectiveFrom),
      );
    return rows.map(toManagementRecord);
  }

  async create(input: HourlyWageRule & { userId: string }) {
    try {
      return await this.transaction(async (tx) => {
        await lockHourlyWageRulesForUser(tx, input.userId);
        const [created] = await tx
          .insert(hourlyWageRules)
          .values(input)
          .returning();
        if (!created) throw new Error("Failed to create hourly wage rules.");
        return {
          kind: "created" as const,
          hourlyWageRule: toManagementRecord(created),
        };
      });
    } catch (error) {
      if (hasDatabaseErrorCode(error, "23505"))
        return { kind: "already-exists" as const };
      throw error;
    }
  }

  async update(input: {
    userId: string;
    hourlyWageRuleId: string;
    expectedVersion: number;
    mutation: Omit<HourlyWageRule, "userId">;
  }) {
    try {
      return await this.transaction(async (tx) => {
        await lockHourlyWageRulesForUser(tx, input.userId);
        const [updated] = await tx
          .update(hourlyWageRules)
          .set({
            ...input.mutation,
            version: sql`${hourlyWageRules.version} + 1`,
          })
          .where(
            and(
              eq(hourlyWageRules.id, input.hourlyWageRuleId),
              eq(hourlyWageRules.userId, input.userId),
              eq(hourlyWageRules.version, input.expectedVersion),
            ),
          )
          .returning();
        if (updated)
          return {
            kind: "updated" as const,
            hourlyWageRule: toManagementRecord(updated),
          };
        const [existing] = await tx
          .select({ version: hourlyWageRules.version })
          .from(hourlyWageRules)
          .where(
            and(
              eq(hourlyWageRules.id, input.hourlyWageRuleId),
              eq(hourlyWageRules.userId, input.userId),
            ),
          )
          .limit(1);
        return existing
          ? { kind: "version-conflict" as const }
          : { kind: "rule-not-found" as const };
      });
    } catch (error) {
      if (hasDatabaseErrorCode(error, "23505"))
        return { kind: "already-exists" as const };
      throw error;
    }
  }

  async delete(input: {
    userId: string;
    hourlyWageRuleId: string;
    expectedVersion: number;
  }) {
    return this.transaction(async (tx) => {
      await lockHourlyWageRulesForUser(tx, input.userId);
      const [deleted] = await tx
        .delete(hourlyWageRules)
        .where(
          and(
            eq(hourlyWageRules.id, input.hourlyWageRuleId),
            eq(hourlyWageRules.userId, input.userId),
            eq(hourlyWageRules.version, input.expectedVersion),
          ),
        )
        .returning({ id: hourlyWageRules.id });
      if (deleted)
        return { kind: "deleted" as const, hourlyWageRuleId: deleted.id };
      const [existing] = await tx
        .select({ version: hourlyWageRules.version })
        .from(hourlyWageRules)
        .where(
          and(
            eq(hourlyWageRules.id, input.hourlyWageRuleId),
            eq(hourlyWageRules.userId, input.userId),
          ),
        )
        .limit(1);
      return existing
        ? { kind: "version-conflict" as const }
        : { kind: "rule-not-found" as const };
    });
  }

  async bulkUpdate(
    userId: string,
    input: Parameters<HourlyWageRuleManagementPersistencePort["bulkUpdate"]>[1],
    plan: Parameters<HourlyWageRuleManagementPersistencePort["bulkUpdate"]>[2],
  ) {
    try {
      return await this.transaction(async (tx) => {
        await lockHourlyWageRulesForUser(tx, userId);
        const rows = await tx
          .select()
          .from(hourlyWageRules)
          .where(eq(hourlyWageRules.userId, userId));
        const result = plan(rows.map(toManagementRecord));
        if (result.kind === "bulk-conflict") return result;
        const saved: HourlyWageRuleManagementRecord[] = [];
        for (const operation of result.operations) {
          if (operation.kind === "update") {
            const [updated] = await tx
              .update(hourlyWageRules)
              .set({
                hourlyWage: operation.change.hourlyWage,
                version: sql`${hourlyWageRules.version} + 1`,
              })
              .where(
                and(
                  eq(hourlyWageRules.id, operation.row.id),
                  eq(hourlyWageRules.version, operation.row.version),
                ),
              )
              .returning();
            if (!updated)
              throw Object.assign(new Error("bulk conflict"), {
                code: "BULK_CONFLICT",
              });
            saved.push(toManagementRecord(updated));
          } else {
            const [inserted] = await tx
              .insert(hourlyWageRules)
              .values({
                userId,
                dayType: operation.change.dayType,
                workPeriod: operation.change.workPeriod,
                hourlyWage: operation.change.hourlyWage,
                effectiveFrom: input.effectiveFrom,
              })
              .returning();
            if (inserted) saved.push(toManagementRecord(inserted));
          }
        }
        return { kind: "success" as const, hourlyWageRules: saved };
      });
    } catch (error) {
      if (isBulkConflict(error)) return { kind: "bulk-conflict" as const };
      throw error;
    }
  }
}

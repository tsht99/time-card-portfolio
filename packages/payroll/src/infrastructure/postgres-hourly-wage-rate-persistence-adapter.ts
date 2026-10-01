import type { PostgresDatabase } from "@repo/platform";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  HourlyWageRateApplicationResource,
  HourlyWageRatePersistencePort,
} from "../application/hourly-wage-rate-store.ts";
import type { HourlyWageRate } from "../domain/hourly-wage-rate.ts";
import { hourlyWageRates } from "../schema/hourly-wage-rates.ts";
import { hasDatabaseErrorCode } from "./postgres-error.ts";

type HourlyWageTransaction = Parameters<
  Parameters<PostgresDatabase["transaction"]>[0]
>[0];

function toApplicationResource(
  row: typeof hourlyWageRates.$inferSelect,
): HourlyWageRateApplicationResource {
  return {
    id: row.id,
    userId: row.userId,
    workPeriod: row.workPeriod as HourlyWageRate["workPeriod"],
    dayType: row.dayType as HourlyWageRate["dayType"],
    hourlyWage: row.hourlyWage,
    effectiveFrom: row.effectiveFrom,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

async function lockHourlyWageRatesForUser(
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

export class PostgresHourlyWageRatePersistenceAdapter
  implements HourlyWageRatePersistencePort
{
  constructor(private readonly db: PostgresDatabase) {}

  async findAllForUser(userId: string) {
    const rows = await this.db
      .select()
      .from(hourlyWageRates)
      .where(eq(hourlyWageRates.userId, userId))
      .orderBy(
        asc(hourlyWageRates.workPeriod),
        asc(hourlyWageRates.dayType),
        asc(hourlyWageRates.effectiveFrom),
      );
    return rows.map(toApplicationResource);
  }

  async create(input: HourlyWageRate & { userId: string }) {
    try {
      return await this.db.transaction(async (tx) => {
        await lockHourlyWageRatesForUser(tx, input.userId);
        const [created] = await tx
          .insert(hourlyWageRates)
          .values(input)
          .returning();
        if (!created) throw new Error("Failed to create hourly wage rate.");
        return {
          kind: "created" as const,
          hourlyWageRate: toApplicationResource(created),
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
    hourlyWageRateId: string;
    expectedVersion: number;
    mutation: Omit<HourlyWageRate, "userId">;
  }) {
    try {
      return await this.db.transaction(async (tx) => {
        await lockHourlyWageRatesForUser(tx, input.userId);
        const [updated] = await tx
          .update(hourlyWageRates)
          .set({
            ...input.mutation,
            version: sql`${hourlyWageRates.version} + 1`,
          })
          .where(
            and(
              eq(hourlyWageRates.id, input.hourlyWageRateId),
              eq(hourlyWageRates.userId, input.userId),
              eq(hourlyWageRates.version, input.expectedVersion),
            ),
          )
          .returning();
        if (updated)
          return {
            kind: "updated" as const,
            hourlyWageRate: toApplicationResource(updated),
          };
        const [existing] = await tx
          .select({ version: hourlyWageRates.version })
          .from(hourlyWageRates)
          .where(
            and(
              eq(hourlyWageRates.id, input.hourlyWageRateId),
              eq(hourlyWageRates.userId, input.userId),
            ),
          )
          .limit(1);
        return existing
          ? { kind: "version-conflict" as const }
          : { kind: "rate-not-found" as const };
      });
    } catch (error) {
      if (hasDatabaseErrorCode(error, "23505"))
        return { kind: "already-exists" as const };
      throw error;
    }
  }

  async delete(input: {
    userId: string;
    hourlyWageRateId: string;
    expectedVersion: number;
  }) {
    return this.db.transaction(async (tx) => {
      await lockHourlyWageRatesForUser(tx, input.userId);
      const [deleted] = await tx
        .delete(hourlyWageRates)
        .where(
          and(
            eq(hourlyWageRates.id, input.hourlyWageRateId),
            eq(hourlyWageRates.userId, input.userId),
            eq(hourlyWageRates.version, input.expectedVersion),
          ),
        )
        .returning({ id: hourlyWageRates.id });
      if (deleted)
        return { kind: "deleted" as const, hourlyWageRateId: deleted.id };
      const [existing] = await tx
        .select({ version: hourlyWageRates.version })
        .from(hourlyWageRates)
        .where(
          and(
            eq(hourlyWageRates.id, input.hourlyWageRateId),
            eq(hourlyWageRates.userId, input.userId),
          ),
        )
        .limit(1);
      return existing
        ? { kind: "version-conflict" as const }
        : { kind: "rate-not-found" as const };
    });
  }

  async bulkUpdate(
    userId: string,
    input: Parameters<HourlyWageRatePersistencePort["bulkUpdate"]>[1],
    plan: Parameters<HourlyWageRatePersistencePort["bulkUpdate"]>[2],
  ) {
    try {
      return await this.db.transaction(
        async (tx) => {
          await lockHourlyWageRatesForUser(tx, userId);
          const rows = await tx
            .select()
            .from(hourlyWageRates)
            .where(eq(hourlyWageRates.userId, userId));
          const result = plan(rows.map(toApplicationResource));
          if (result.kind === "bulk-conflict") return result;
          const saved: HourlyWageRateApplicationResource[] = [];
          for (const operation of result.operations) {
            if (operation.kind === "update") {
              const [updated] = await tx
                .update(hourlyWageRates)
                .set({
                  hourlyWage: operation.change.hourlyWage,
                  version: sql`${hourlyWageRates.version} + 1`,
                })
                .where(
                  and(
                    eq(hourlyWageRates.id, operation.row.id),
                    eq(hourlyWageRates.version, operation.row.version),
                  ),
                )
                .returning();
              if (!updated)
                throw Object.assign(new Error("bulk conflict"), {
                  code: "BULK_CONFLICT",
                });
              saved.push(toApplicationResource(updated));
            } else {
              const [inserted] = await tx
                .insert(hourlyWageRates)
                .values({
                  userId,
                  dayType: operation.change.dayType,
                  workPeriod: operation.change.workPeriod,
                  hourlyWage: operation.change.hourlyWage,
                  effectiveFrom: input.effectiveFrom,
                })
                .returning();
              if (inserted) saved.push(toApplicationResource(inserted));
            }
          }
          return { kind: "success" as const, hourlyWageRates: saved };
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (isBulkConflict(error)) return { kind: "bulk-conflict" as const };
      throw error;
    }
  }
}

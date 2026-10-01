import type { PostgresDatabase } from "@repo/platform";
import type { HourlyWageRateStore } from "../application/hourly-wage-rate-store.ts";
import type { HourlyWageRate } from "../domain/hourly-wage-rate.ts";
import { hourlyWageRates } from "../schema/hourly-wage-rates.ts";

function toEffectiveFrom(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`Invalid hourly wage effective date: ${value}`);
  return value;
}

function toDomainHourlyWageRate(
  row: typeof hourlyWageRates.$inferSelect,
): HourlyWageRate {
  return {
    userId: row.userId,
    workPeriod: row.workPeriod,
    dayType: row.dayType,
    hourlyWage: row.hourlyWage,
    effectiveFrom: toEffectiveFrom(row.effectiveFrom),
  };
}

export class PostgresHourlyWageRateStore implements HourlyWageRateStore {
  constructor(private readonly db: PostgresDatabase) {}

  async findAll(): Promise<readonly HourlyWageRate[]> {
    const rows = await this.db.select().from(hourlyWageRates);
    return rows.map(toDomainHourlyWageRate);
  }
}

import type { PostgresDatabase } from "@repo/postgres";
import { sql } from "drizzle-orm";
import type { HourlyWageRuleReadStore } from "../application/ports/hourly-wage-rule-ports.ts";
import type { HourlyWageRule } from "../domain/hourly-wage-rule.ts";

function toEffectiveFrom(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`Invalid hourly wage effective date: ${value}`);
  return value;
}

export class PostgresHourlyWageRuleReadStore
  implements HourlyWageRuleReadStore
{
  constructor(private readonly db: PostgresDatabase) {}

  async findForPayrollEstimate(query: {
    userIds: readonly string[];
    startAttendanceDateInclusive: string;
    endAttendanceDateInclusive: string;
  }): Promise<readonly HourlyWageRule[]> {
    if (query.userIds.length === 0) return [];
    const userIdList = sql.join(
      query.userIds.map((userId) => sql`${userId}::uuid`),
      sql`, `,
    );
    const result = (await this.db.execute(sql`
      with baseline as (
        select distinct on (user_id, work_period, day_type)
               user_id, work_period, day_type, hourly_wage, effective_from
        from hourly_wage_rules
        where user_id in (${userIdList})
          and effective_from < ${query.startAttendanceDateInclusive}::date
        order by user_id, work_period, day_type, effective_from desc
      ), in_period as (
        select user_id, work_period, day_type, hourly_wage, effective_from
        from hourly_wage_rules
        where user_id in (${userIdList})
          and effective_from >= ${query.startAttendanceDateInclusive}::date
          and effective_from <= ${query.endAttendanceDateInclusive}::date
      )
      select user_id as "userId", work_period as "workPeriod",
             day_type as "dayType", hourly_wage as "hourlyWage",
             effective_from as "effectiveFrom"
      from (select * from baseline union all select * from in_period) as payroll_rules
      order by user_id, work_period, day_type, effective_from
    `)) as unknown as { rows: Array<Record<string, unknown>> };
    return result.rows.map((row) => ({
      userId: String(row.userId),
      workPeriod: row.workPeriod as HourlyWageRule["workPeriod"],
      dayType: row.dayType as HourlyWageRule["dayType"],
      hourlyWage: Number(row.hourlyWage),
      effectiveFrom: toEffectiveFrom(String(row.effectiveFrom).slice(0, 10)),
    }));
  }
}

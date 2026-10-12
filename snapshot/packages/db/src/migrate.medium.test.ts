import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  databaseUrl,
  startMediumPostgresDatabase,
  startMediumPostgresTemplate,
} from "@repo/test-support/medium-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Pool } from "pg";
// cspell:ignore conrelid enumlabel enumsortorder
// cspell:ignore enumtypid regnamespace typname typnamespace

import { runMigrations } from "./migration-runner.ts";

const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const migrationCount = readMigrationFiles({ migrationsFolder }).length;

const expectedEnumValues = {
  attendance_event_type: [
    "AttendanceClockedIn",
    "AttendanceClockedOut",
    "WorkPeriodCorrected",
    "ClockInTimeCorrected",
    "ClockOutTimeCorrected",
    "AttendanceCancelled",
  ],
  hourly_wage_day_type: [
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "holiday",
  ],
  user_role: ["staff", "admin"],
  user_status: ["pending", "active", "inactive"],
  work_period: ["day", "night"],
} as const;

describe("database migrations", { concurrency: false }, () => {
  let template: Awaited<ReturnType<typeof startMediumPostgresTemplate>>;

  before(async () => {
    template = await startMediumPostgresTemplate();
  });

  after(async () => {
    await template.close();
  });

  async function withDatabase(fn: (url: string, pool: Pool) => Promise<void>) {
    const database = await startMediumPostgresDatabase({
      maintenanceUrl: databaseUrl(template.templateUrl, "postgres"),
    });
    try {
      await fn(database.databaseUrl, database.pool);
    } finally {
      await database.close();
    }
  }
  it("applies fresh migrations and records every migration", async () =>
    withDatabase(async (url, pool) => {
      await runMigrations("local", {
        DATABASE_URL: url,
        DATABASE_ENVIRONMENT: "local",
      });
      assert.equal(
        (await pool.query("select count(*)::int as count from users")).rows[0]
          .count,
        0,
      );
      assert.deepEqual(
        (
          await pool.query(
            `select is_nullable from information_schema.columns
             where table_schema = 'public' and table_name = 'auth_sessions'
               and column_name = 'credential_hash'`,
          )
        ).rows,
        [{ is_nullable: "NO" }],
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as count from drizzle.__drizzle_migrations",
          )
        ).rows[0].count,
        migrationCount,
      );
      assert.deepEqual(
        (
          await pool.query(
            `select to_regclass('public.hourly_wage_rules') as rules,
                    to_regclass('public.hourly_wage_rates') as rates`,
          )
        ).rows,
        [{ rules: "hourly_wage_rules", rates: null }],
      );
      assert.deepEqual(
        (
          await pool.query(
            `select column_name
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'hourly_wage_rules'
             order by ordinal_position`,
          )
        ).rows.map((row) => row.column_name),
        [
          "id",
          "user_id",
          "work_period",
          "day_type",
          "hourly_wage",
          "effective_from",
          "version",
          "created_at",
        ],
      );
      assert.deepEqual(
        (
          await pool.query(
            `select conname
             from pg_constraint
             where conrelid = 'public.hourly_wage_rules'::regclass
               and conname = any($1::text[])
             order by conname`,
            [
              [
                "hourly_wage_rules_hourly_wage_range_check",
                "hourly_wage_rules_user_period_day_effective_unique",
                "hourly_wage_rules_version_positive_check",
              ],
            ],
          )
        ).rows.map((row) => row.conname),
        [
          "hourly_wage_rules_hourly_wage_range_check",
          "hourly_wage_rules_user_period_day_effective_unique",
          "hourly_wage_rules_version_positive_check",
        ],
      );
      assert.deepEqual(
        (
          await pool.query(
            `select table_name, column_name, udt_name as enum_type
             from information_schema.columns
             where table_schema = 'public'
               and (table_name, column_name) in (
                 ('users', 'role'),
                 ('users', 'status'),
                 ('attendance_current_states', 'work_period'),
                 ('attendance_events', 'event_type'),
                 ('hourly_wage_rules', 'work_period'),
                 ('hourly_wage_rules', 'day_type'),
                 ('hourly_wage_rules', 'version')
               )
             order by table_name, column_name`,
          )
        ).rows,
        [
          {
            table_name: "attendance_current_states",
            column_name: "work_period",
            enum_type: "work_period",
          },
          {
            table_name: "attendance_events",
            column_name: "event_type",
            enum_type: "attendance_event_type",
          },
          {
            table_name: "hourly_wage_rules",
            column_name: "day_type",
            enum_type: "hourly_wage_day_type",
          },
          {
            table_name: "hourly_wage_rules",
            column_name: "version",
            enum_type: "int4",
          },
          {
            table_name: "hourly_wage_rules",
            column_name: "work_period",
            enum_type: "work_period",
          },
          { table_name: "users", column_name: "role", enum_type: "user_role" },
          {
            table_name: "users",
            column_name: "status",
            enum_type: "user_status",
          },
        ],
      );
      assert.deepEqual(
        (
          await pool.query(
            `select a.udt_name as attendance_type,
                    h.udt_name as hourly_wage_type
             from information_schema.columns a
             join information_schema.columns h
               on h.table_schema = 'public'
              and h.table_name = 'hourly_wage_rules'
              and h.column_name = 'work_period'
             where a.table_schema = 'public'
               and a.table_name = 'attendance_current_states'
               and a.column_name = 'work_period'`,
          )
        ).rows,
        [{ attendance_type: "work_period", hourly_wage_type: "work_period" }],
      );

      const enumValues = await pool.query(
        `select t.typname as enum_type, e.enumlabel as enum_value
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
         where t.typnamespace = 'public'::regnamespace
           and t.typname = any($1::text[])
         order by t.typname, e.enumsortorder`,
        [Object.keys(expectedEnumValues)],
      );
      assert.deepEqual(
        Object.fromEntries(
          Object.keys(expectedEnumValues).map((enumType) => [
            enumType,
            enumValues.rows
              .filter((row) => row.enum_type === enumType)
              .map((row) => row.enum_value),
          ]),
        ),
        expectedEnumValues,
      );
      assert.deepEqual(
        (
          await pool.query(
            `select typname
             from pg_type
            where typnamespace = 'public'::regnamespace
              and typname in ('clock_in_status', 'clock_out_status')`,
          )
        ).rows,
        [],
      );
      for (const enumType of Object.keys(expectedEnumValues)) {
        await assert.rejects(
          pool.query(`select 'not-a-valid-value'::"${enumType}"`),
        );
      }
      await assert.rejects(
        pool.query(
          `insert into users (line_user_id, role)
           values ('migration-invalid-role', 'not-a-valid-value')`,
        ),
      );

      const hourlyWageRangeCheck = await pool.query(
        `select pg_get_constraintdef(oid) as definition
         from pg_constraint
         where conrelid = 'public.hourly_wage_rules'::regclass
           and conname = 'hourly_wage_rules_hourly_wage_range_check'`,
      );
      assert.equal(hourlyWageRangeCheck.rows.length, 1);
      assert.match(hourlyWageRangeCheck.rows[0].definition, /hourly_wage >= 0/);
      assert.match(
        hourlyWageRangeCheck.rows[0].definition,
        /hourly_wage <= 99999/,
      );
      const hourlyWageVersionColumn = await pool.query(
        `select data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'hourly_wage_rules'
           and column_name = 'version'`,
      );
      assert.deepEqual(hourlyWageVersionColumn.rows, [
        {
          data_type: "integer",
          is_nullable: "NO",
          column_default: "1",
        },
      ]);
      const hourlyWageVersionCheck = await pool.query(
        `select pg_get_constraintdef(oid) as definition
         from pg_constraint
         where conrelid = 'public.hourly_wage_rules'::regclass
           and conname = 'hourly_wage_rules_version_positive_check'`,
      );
      assert.equal(hourlyWageVersionCheck.rows.length, 1);
      assert.match(hourlyWageVersionCheck.rows[0].definition, /version >= 1/);
      assert.deepEqual(
        (
          await pool.query(
            `select to_regclass('public.finalized_attendances') as relation`,
          )
        ).rows,
        [{ relation: null }],
      );
      assert.deepEqual(
        (
          await pool.query(
            `select to_regclass('public.push_subscriptions') as relation`,
          )
        ).rows,
        [{ relation: null }],
      );
      assert.deepEqual(
        (
          await pool.query(
            `select column_name
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'auth_sessions'
               and column_name = 'csrf_token'`,
          )
        ).rows,
        [],
      );
      assert.deepEqual(
        (
          await pool.query(
            `select column_name
             from information_schema.columns
             where table_schema = 'public'
               and table_name = 'users'
               and column_name = 'picture_url'`,
          )
        ).rows,
        [],
      );

      const defaultUser = await pool.query(
        `insert into users (line_user_id, display_name)
         values ('migration-default-user', 'Default User')
         returning role, status`,
      );
      const explicitUsers = await pool.query(
        `with inserted_users as (
           insert into users (line_user_id, display_name, status)
           values ('migration-active-user', 'Active User', 'active'),
                  ('migration-inactive-user', 'Inactive User', 'inactive')
           returning line_user_id, status
         )
         select status
         from inserted_users
         order by line_user_id`,
      );
      assert.deepEqual(defaultUser.rows, [
        { role: "staff", status: "pending" },
      ]);
      assert.deepEqual(explicitUsers.rows, [
        { status: "active" },
        { status: "inactive" },
      ]);
      const defaultHourlyWageRule = await pool.query(
        `with inserted_user as (
           insert into users (line_user_id, display_name)
           values ('migration-hourly-wage-user', 'Hourly Wage User')
           returning id
         )
         insert into hourly_wage_rules (
           user_id, work_period, day_type, hourly_wage, effective_from
         )
         select id, 'day', 'mon', 1200, '2026-08-01'
         from inserted_user
         returning version`,
      );
      assert.deepEqual(defaultHourlyWageRule.rows, [{ version: 1 }]);
      await assert.rejects(
        pool.query(
          `insert into hourly_wage_rules (
             user_id, work_period, day_type, hourly_wage, effective_from, version
           )
           select id, 'day', 'tue', 1200, '2026-08-01', 0
           from users
           where line_user_id = 'migration-hourly-wage-user'`,
        ),
      );
    }));
  it("succeeds when rerun", async () =>
    withDatabase(async (url, pool) => {
      await runMigrations("local", {
        DATABASE_URL: url,
        DATABASE_ENVIRONMENT: "local",
      });
      await runMigrations("local", {
        DATABASE_URL: url,
        DATABASE_ENVIRONMENT: "local",
      });
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as count from drizzle.__drizzle_migrations",
          )
        ).rows[0].count,
        migrationCount,
      );
    }));
  it("succeeds concurrently without duplicate history", async () =>
    withDatabase(async (url, pool) => {
      await Promise.all([
        runMigrations("local", {
          DATABASE_URL: url,
          DATABASE_ENVIRONMENT: "local",
        }),
        runMigrations("local", {
          DATABASE_URL: url,
          DATABASE_ENVIRONMENT: "local",
        }),
      ]);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as count from drizzle.__drizzle_migrations",
          )
        ).rows[0].count,
        migrationCount,
      );
    }));
});

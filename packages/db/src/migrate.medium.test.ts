import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { runMigrations } from "./migration-runner.ts";
import {
  assertPostgres18Version,
  EXTERNAL_POSTGRES_URL_ENV,
  parseExternalMaintenanceUrl,
} from "./test/medium-postgres-config.ts";

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
  const maintenanceDatabaseName = "postgres";
  let container: StartedPostgreSqlContainer | undefined;
  let maintenanceUrl: string | undefined;
  let databaseCounter = 0;

  function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
  }

  function databaseConnectionString(
    baseUrl: string,
    databaseName: string,
  ): string {
    const url = new URL(baseUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
  }

  async function dropDatabase(
    maintenancePool: Pool,
    databaseName: string,
  ): Promise<void> {
    await maintenancePool.query(
      `DROP DATABASE ${quoteIdentifier(databaseName)}`,
    );
  }

  before(async () => {
    try {
      const externalUrl = process.env[EXTERNAL_POSTGRES_URL_ENV];
      if (externalUrl !== undefined) {
        maintenanceUrl = parseExternalMaintenanceUrl(externalUrl).toString();
        const pool = new Pool({ connectionString: maintenanceUrl });
        try {
          const version = await pool.query<{ server_version_num: string }>(
            "select current_setting('server_version_num') as server_version_num",
          );
          assertPostgres18Version(version.rows[0]?.server_version_num ?? "");
        } finally {
          await pool.end();
        }
      } else {
        container = await new PostgreSqlContainer("postgres:18-alpine")
          .withDatabase(maintenanceDatabaseName)
          .start();
        maintenanceUrl = container.getConnectionUri();
      }
    } catch (error) {
      await container?.stop().catch(() => undefined);
      container = undefined;
      throw error;
    }
  });

  after(async () => {
    const startedContainer = container;
    container = undefined;
    maintenanceUrl = undefined;
    await startedContainer?.stop();
  });

  async function withDatabase(fn: (url: string, pool: Pool) => Promise<void>) {
    const baseUrl = maintenanceUrl;
    if (baseUrl === undefined) {
      throw new Error("The database migration test container is not started");
    }

    const databaseName = `timecard_migration_${process.pid}_${++databaseCounter}`;
    const databaseUrl = databaseConnectionString(baseUrl, databaseName);
    const maintenancePool = new Pool({ connectionString: baseUrl });
    let databaseCreated = false;
    let pool: Pool | undefined;

    try {
      await maintenancePool.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)}`,
      );
      databaseCreated = true;

      pool = new Pool({ connectionString: databaseUrl });
      await fn(databaseUrl, pool);
    } finally {
      try {
        await pool?.end();
      } finally {
        try {
          if (databaseCreated) {
            await dropDatabase(maintenancePool, databaseName);
          }
        } finally {
          await maintenancePool.end();
        }
      }
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
            `select table_name, column_name, udt_name as enum_type
             from information_schema.columns
             where table_schema = 'public'
               and (table_name, column_name) in (
                 ('users', 'role'),
                 ('users', 'status'),
                 ('attendance_current_states', 'work_period'),
                 ('attendance_events', 'event_type'),
                 ('hourly_wage_rates', 'work_period'),
                 ('hourly_wage_rates', 'day_type'),
                 ('hourly_wage_rates', 'version')
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
            table_name: "hourly_wage_rates",
            column_name: "day_type",
            enum_type: "hourly_wage_day_type",
          },
          {
            table_name: "hourly_wage_rates",
            column_name: "version",
            enum_type: "int4",
          },
          {
            table_name: "hourly_wage_rates",
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
              and h.table_name = 'hourly_wage_rates'
              and h.column_name = 'work_period'
             where a.table_schema = 'public'
               and a.table_name = 'attendance_current_states'
               and a.column_name = 'work_period'`,
          )
        ).rows,
        [{ attendance_type: "work_period", hourly_wage_type: "work_period" }],
      );

      // cspell:disable
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
      // cspell:enable
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

      // cspell:disable
      const hourlyWageRangeCheck = await pool.query(
        `select pg_get_constraintdef(oid) as definition
         from pg_constraint
         where conrelid = 'public.hourly_wage_rates'::regclass
           and conname = 'hourly_wage_rates_hourly_wage_range_check'`,
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
           and table_name = 'hourly_wage_rates'
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
         where conrelid = 'public.hourly_wage_rates'::regclass
           and conname = 'hourly_wage_rates_version_positive_check'`,
      );
      assert.equal(hourlyWageVersionCheck.rows.length, 1);
      assert.match(hourlyWageVersionCheck.rows[0].definition, /version >= 1/);
      // cspell:enable
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
      const defaultHourlyWageRate = await pool.query(
        `with inserted_user as (
           insert into users (line_user_id, display_name)
           values ('migration-hourly-wage-user', 'Hourly Wage User')
           returning id
         )
         insert into hourly_wage_rates (
           user_id, work_period, day_type, hourly_wage, effective_from
         )
         select id, 'day', 'mon', 1200, '2026-08-01'
         from inserted_user
         returning version`,
      );
      assert.deepEqual(defaultHourlyWageRate.rows, [{ version: 1 }]);
      await assert.rejects(
        pool.query(
          `insert into hourly_wage_rates (
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

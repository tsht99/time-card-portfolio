import { createHash } from "node:crypto";
import type { Pool } from "pg";

export type AdvisoryLockKey = readonly [first: number, second: number];
export type AdvisoryLockCount = { granted: boolean; count: number };

/** Mirrors the two-int key encoding used by PostgresAttendanceEventStore. */
export function advisoryLockKey(value: string): AdvisoryLockKey {
  const digest = createHash("sha256").update(value).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function oidValue(value: number): number {
  return value >>> 0;
}

export async function readAdvisoryLockCounts(
  pool: Pick<Pool, "query">,
  [first, second]: AdvisoryLockKey,
): Promise<AdvisoryLockCount[]> {
  // cspell:ignore datname classid objid objsubid
  const result = await pool.query<AdvisoryLockCount>(
    `
      SELECT granted, count(*)::int AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND mode = 'ExclusiveLock'
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = $1::oid
        AND objid = $2::oid
        AND objsubid = 2
      GROUP BY granted
      ORDER BY granted DESC
    `,
    [oidValue(first), oidValue(second)],
  );
  return result.rows;
}

export function advisoryLockCount(
  rows: readonly AdvisoryLockCount[],
  granted: boolean,
): number {
  return rows.find((row) => row.granted === granted)?.count ?? 0;
}

export async function waitForAdvisoryLockState(
  pool: Pick<Pool, "query">,
  key: AdvisoryLockKey,
  predicate: (rows: readonly AdvisoryLockCount[]) => boolean,
  description = "the expected advisory lock state",
): Promise<AdvisoryLockCount[]> {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const rows = await readAdvisoryLockCounts(pool, key);
    if (predicate(rows)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

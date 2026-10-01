import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresDatabase } from "@repo/platform";
import { PostgresHourlyWageRatePersistenceAdapter } from "./postgres-hourly-wage-rate-persistence-adapter.ts";

function portRejecting(error: unknown) {
  const db = {
    transaction: async () => {
      throw error;
    },
  } as unknown as PostgresDatabase;
  return new PostgresHourlyWageRatePersistenceAdapter(db);
}

for (const code of ["40001", "40P01"]) {
  test(`bulk update propagates PostgreSQL infrastructure error ${code}`, async () => {
    const error = Object.assign(new Error(`database failure ${code}`), {
      code,
    });

    await assert.rejects(
      portRejecting(error).bulkUpdate("user-1", {} as never, () => ({
        kind: "success",
        operations: [],
      })),
      (caught) => caught === error,
    );
  });
}

test("bulk update preserves unique violations as business conflicts", async () => {
  const error = Object.assign(new Error("duplicate key"), { code: "23505" });

  assert.deepEqual(
    await portRejecting(error).bulkUpdate("user-1", {} as never, () => ({
      kind: "success",
      operations: [],
    })),
    { kind: "bulk-conflict" },
  );
});

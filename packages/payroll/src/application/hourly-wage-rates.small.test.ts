import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import test from "node:test";
import type { HourlyWageRateApplicationResource } from "./hourly-wage-rate-store.ts";
import {
  createHourlyWageRateManagementApplication,
  type HourlyWageRateManagementApplication,
} from "./hourly-wage-rates.ts";

type CreateHourlyWageRateTestInput = Parameters<
  HourlyWageRateManagementApplication["createHourlyWageRate"]
>[0];
type CreateHourlyWageRatePersistenceTestInput = Omit<
  CreateHourlyWageRateTestInput,
  "actorUserId"
>;

const staffId = "11111111-1111-4111-8111-111111111111";
const adminId = "88888888-8888-4888-8888-888888888888";
const otherAdminId = "99999999-9999-4999-8999-999999999999";
const unknownRoleUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const missingUserId = "22222222-2222-4222-8222-222222222222";
const rateId = "33333333-3333-4333-8333-333333333333";
const missingRateId = "44444444-4444-4444-8444-444444444444";

function rate(
  overrides: Partial<HourlyWageRateApplicationResource> = {},
): HourlyWageRateApplicationResource {
  return {
    id: rateId,
    userId: staffId,
    workPeriod: "day",
    dayType: "mon",
    hourlyWage: 1200,
    effectiveFrom: "2026-01-01",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeApplication(
  options: {
    create?: (
      input: CreateHourlyWageRatePersistenceTestInput,
    ) => Promise<
      | { kind: "created"; hourlyWageRate: HourlyWageRateApplicationResource }
      | { kind: "already-exists" }
    >;
    createdInputs?: unknown[];
  } = {},
) {
  const rates = [rate()];
  const roles: Record<string, string> = {
    [staffId]: "staff",
    [adminId]: "admin",
    [otherAdminId]: "admin",
    [unknownRoleUserId]: "unknown",
  };
  const calls = { create: 0, update: 0, delete: 0, bulk: 0, version: 0 };
  return {
    rates,
    roles,
    calls,
    application: createHourlyWageRateManagementApplication({
      userReferences: {
        async getUserById(userId) {
          const role = roles[userId];
          return role
            ? {
                userId,
                role: role as "staff" | "admin",
                displayName: null,
              }
            : null;
        },
      },
      hourlyWageRatePersistence: {
        async findAllForUser(userId) {
          return rates.filter((candidate) => candidate.userId === userId);
        },
        async create(input) {
          calls.create += 1;
          options.createdInputs?.push(input);
          return (
            (await options.create?.(input)) ?? {
              kind: "created" as const,
              hourlyWageRate: rate({
                id: "55555555-5555-4555-8555-555555555555",
                ...input,
              }),
            }
          );
        },
        async update({ userId, hourlyWageRateId, expectedVersion, mutation }) {
          calls.update += 1;
          const existing = rates.find(
            (candidate) =>
              candidate.userId === userId && candidate.id === hourlyWageRateId,
          );
          if (!existing) return { kind: "rate-not-found" as const };
          if (existing.version !== expectedVersion)
            return { kind: "version-conflict" as const };
          Object.assign(existing, mutation);
          existing.version += 1;
          return { kind: "updated" as const, hourlyWageRate: existing };
        },
        async delete({ userId, hourlyWageRateId, expectedVersion }) {
          calls.delete += 1;
          const index = rates.findIndex(
            (candidate) =>
              candidate.userId === userId && candidate.id === hourlyWageRateId,
          );
          const existing = rates[index];
          if (!existing) return { kind: "rate-not-found" as const };
          if (existing.version !== expectedVersion)
            return { kind: "version-conflict" as const };
          const deletedId = rates.splice(index, 1)[0]?.id;
          return {
            kind: "deleted" as const,
            hourlyWageRateId: deletedId ?? hourlyWageRateId,
          };
        },
        async bulkUpdate(userId, _input, plan) {
          calls.bulk += 1;
          const planned = plan(
            rates.filter((candidate) => candidate.userId === userId),
          );
          return planned.kind === "bulk-conflict"
            ? planned
            : { kind: "success" as const, hourlyWageRates: [] };
        },
      },
    }),
  };
}

test("時給ルール CRUD は成功結果を返し、更新対象は4項目だけ", async () => {
  const createdInputs: unknown[] = [];
  const { application, rates } = makeApplication({ createdInputs });
  strictEqual(
    (
      await application.createHourlyWageRate({
        ...rate(),
        userId: staffId,
        actorUserId: adminId,
      })
    ).kind,
    "success",
  );
  deepStrictEqual(createdInputs, [
    {
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1200,
      effectiveFrom: "2026-01-01",
      userId: staffId,
    },
  ]);
  strictEqual((await application.getHourlyWageRates(staffId)).kind, "success");
  const updated = await application.updateHourlyWageRate({
    actorUserId: adminId,
    userId: staffId,
    hourlyWageRateId: rateId,
    expectedVersion: 1,
    workPeriod: "night",
    dayType: "holiday",
    hourlyWage: 1500,
    effectiveFrom: "2026-02-01",
  });
  deepStrictEqual(updated, {
    kind: "success",
    hourlyWageRate: rate({
      workPeriod: "night",
      dayType: "holiday",
      hourlyWage: 1500,
      effectiveFrom: "2026-02-01",
      version: 2,
    }),
  });
  deepStrictEqual(
    await application.updateHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRateId: rateId,
      expectedVersion: 1,
      workPeriod: "day",
      dayType: "sun",
      hourlyWage: 1600,
      effectiveFrom: "2026-03-01",
    }),
    { kind: "version-conflict" },
  );
  deepStrictEqual(
    rates[0],
    rate({
      workPeriod: "night",
      dayType: "holiday",
      hourlyWage: 1500,
      effectiveFrom: "2026-02-01",
      version: 2,
    }),
  );
  deepStrictEqual(
    await application.deleteHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRateId: rateId,
      expectedVersion: 1,
    }),
    { kind: "version-conflict" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRateId: rateId,
      expectedVersion: 2,
    }),
    { kind: "success", hourlyWageRateId: rateId },
  );
  strictEqual(rates.length, 0);
});

test("存在しない user と rate を区別し、時給一覧の順序を保つ", async () => {
  const { application, rates } = makeApplication();
  rates.push(
    rate({
      id: "66666666-6666-4666-8666-666666666666",
      workPeriod: "night",
      dayType: "sun",
      effectiveFrom: "2026-01-02",
    }),
    rate({
      id: "77777777-7777-4777-8777-777777777777",
      workPeriod: "day",
      dayType: "fri",
      effectiveFrom: "2026-01-03",
    }),
  );
  const listed = await application.getHourlyWageRates(staffId);
  if (listed.kind !== "success") throw new Error("Expected success.");
  deepStrictEqual(
    listed.hourlyWageRates.map(({ id }) => id),
    [
      "77777777-7777-4777-8777-777777777777",
      rateId,
      "66666666-6666-4666-8666-666666666666",
    ],
  );
  deepStrictEqual(await application.getHourlyWageRates(missingUserId), {
    kind: "user-not-found",
  });
  deepStrictEqual(
    await application.updateHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRateId: missingRateId,
      expectedVersion: 1,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1,
      effectiveFrom: "2026-01-01",
    }),
    { kind: "rate-not-found" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRate({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRateId: missingRateId,
      expectedVersion: 1,
    }),
    { kind: "rate-not-found" },
  );
});

test("管理対象のroleに基づいて時給変更を認可し、昇格後の既存ルールも保護する", async () => {
  const { application, calls, rates, roles } = makeApplication();
  const adminRateId = "88888888-8888-4888-8888-888888888889";
  rates.push(rate({ id: adminRateId, userId: adminId }));

  deepStrictEqual(
    await application.createHourlyWageRate({
      actorUserId: otherAdminId,
      userId: adminId,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.updateHourlyWageRate({
      actorUserId: otherAdminId,
      userId: adminId,
      hourlyWageRateId: adminRateId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRate({
      actorUserId: otherAdminId,
      userId: adminId,
      hourlyWageRateId: adminRateId,
      expectedVersion: 1,
    }),
    { kind: "role-forbidden" },
  );
  strictEqual(calls.create, 0);
  strictEqual(calls.update, 0);
  strictEqual(calls.delete, 0);
  strictEqual(calls.version, 0);
  deepStrictEqual(
    rates.find(({ id }) => id === adminRateId),
    rate({
      id: adminRateId,
      userId: adminId,
    }),
  );
  strictEqual((await application.getHourlyWageRates(adminId)).kind, "success");

  strictEqual(
    (
      await application.createHourlyWageRate({
        actorUserId: adminId,
        userId: adminId,
        workPeriod: "night",
        dayType: "mon",
        hourlyWage: 1300,
        effectiveFrom: "2026-02-01",
      })
    ).kind,
    "success",
  );
  deepStrictEqual(
    await application.updateHourlyWageRate({
      actorUserId: adminId,
      userId: adminId,
      hourlyWageRateId: adminRateId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    {
      kind: "success",
      hourlyWageRate: rate({
        id: adminRateId,
        userId: adminId,
        workPeriod: "night",
        hourlyWage: 1300,
        effectiveFrom: "2026-02-01",
        version: 2,
      }),
    },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRate({
      actorUserId: adminId,
      userId: adminId,
      hourlyWageRateId: adminRateId,
      expectedVersion: 2,
    }),
    { kind: "success", hourlyWageRateId: adminRateId },
  );
  strictEqual(
    (
      await application.createHourlyWageRate({
        actorUserId: otherAdminId,
        userId: staffId,
        workPeriod: "night",
        dayType: "mon",
        hourlyWage: 1300,
        effectiveFrom: "2026-02-01",
      })
    ).kind,
    "success",
  );

  roles[staffId] = "admin";
  deepStrictEqual(
    await application.updateHourlyWageRate({
      actorUserId: otherAdminId,
      userId: staffId,
      hourlyWageRateId: rateId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRate({
      actorUserId: otherAdminId,
      userId: staffId,
      hourlyWageRateId: rateId,
      expectedVersion: 1,
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.updateHourlyWageRate({
      actorUserId: staffId,
      userId: staffId,
      hourlyWageRateId: rateId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    {
      kind: "success",
      hourlyWageRate: rate({
        workPeriod: "night",
        dayType: "mon",
        hourlyWage: 1300,
        effectiveFrom: "2026-02-01",
        version: 2,
      }),
    },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRate({
      actorUserId: staffId,
      userId: staffId,
      hourlyWageRateId: rateId,
      expectedVersion: 2,
    }),
    { kind: "success", hourlyWageRateId: rateId },
  );
  deepStrictEqual(
    await application.createHourlyWageRate({
      actorUserId: otherAdminId,
      userId: unknownRoleUserId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1200,
      effectiveFrom: "2026-01-01",
    }),
    { kind: "role-forbidden" },
  );
});

test("persistenceのunique conflictをalready-existsにし、その他の例外は再送出する", async () => {
  const duplicate = makeApplication({
    create: async () => ({ kind: "already-exists" }),
  });
  deepStrictEqual(
    await duplicate.application.createHourlyWageRate({
      ...rate(),
      userId: staffId,
      actorUserId: adminId,
    }),
    { kind: "already-exists" },
  );
  const failure = new Error("unexpected");
  const unexpected = makeApplication({
    create: async () => {
      throw failure;
    },
  });
  await rejects(
    () =>
      unexpected.application.createHourlyWageRate({
        ...rate(),
        userId: staffId,
        actorUserId: adminId,
      }),
    failure,
  );
});

test("bulk時給の変更はCRUDと同じ対象ユーザー認可とエラーを使う", async () => {
  const { application, calls } = makeApplication();
  const input = {
    actorUserId: adminId,
    effectiveFrom: "2026-02-01",
    changes: [],
  };
  deepStrictEqual(
    await application.bulkUpdateHourlyWageRates({
      ...input,
      userId: missingUserId,
    }),
    { kind: "user-not-found" },
  );
  deepStrictEqual(
    await application.bulkUpdateHourlyWageRates({
      ...input,
      userId: otherAdminId,
    }),
    { kind: "role-forbidden" },
  );
  strictEqual(calls.bulk, 0);
  strictEqual(
    (
      await application.bulkUpdateHourlyWageRates({
        ...input,
        userId: staffId,
      })
    ).kind,
    "success",
  );
  strictEqual(
    (
      await application.bulkUpdateHourlyWageRates({
        ...input,
        userId: adminId,
        actorUserId: adminId,
      })
    ).kind,
    "success",
  );
  strictEqual(calls.bulk, 2);
});

test("bulk時給plannerはexact update、insert、同値no-op、後日rule維持、stale baselineを判定する", async () => {
  const { planBulkHourlyWageRateChanges } = await import(
    "./hourly-wage-rate-bulk.ts"
  );
  const existing = {
    id: rateId,
    userId: staffId,
    workPeriod: "day" as const,
    dayType: "mon" as const,
    hourlyWage: 1200,
    effectiveFrom: "2026-01-01",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const future = {
    ...existing,
    id: "55555555-5555-4555-8555-555555555555",
    effectiveFrom: "2027-01-01",
    hourlyWage: 1800,
  };
  const effectiveFrom = "2026-06-01";
  const target = {
    ...existing,
    id: "66666666-6666-4666-8666-666666666666",
    effectiveFrom,
    hourlyWage: 1250,
    version: 2,
  };
  const baseline = { id: target.id, version: target.version };
  const plan = planBulkHourlyWageRateChanges([existing, target, future], {
    effectiveFrom,
    changes: [
      {
        dayType: "mon",
        workPeriod: "day",
        hourlyWage: 1300,
        expectedBaseline: baseline,
      },
      {
        dayType: "tue",
        workPeriod: "night",
        hourlyWage: 1500,
        expectedBaseline: null,
      },
      {
        dayType: "mon",
        workPeriod: "night",
        hourlyWage: 900,
        expectedBaseline: null,
      },
    ],
  });
  strictEqual(plan.kind, "success");
  if (plan.kind !== "success") throw new Error("Expected valid bulk plan.");
  deepStrictEqual(
    plan.operations.map((operation) => operation.kind),
    ["update", "insert", "insert"],
  );
  const noOp = planBulkHourlyWageRateChanges([existing, target], {
    effectiveFrom,
    changes: [
      {
        dayType: "mon",
        workPeriod: "day",
        hourlyWage: 1250,
        expectedBaseline: baseline,
      },
    ],
  });
  strictEqual(noOp.kind, "success");
  if (noOp.kind === "success") strictEqual(noOp.operations.length, 0);
  const stale = planBulkHourlyWageRateChanges([existing], {
    effectiveFrom: "2026-06-01",
    changes: [
      {
        dayType: "mon",
        workPeriod: "day",
        hourlyWage: 1300,
        expectedBaseline: null,
      },
    ],
  });
  deepStrictEqual(stale, { kind: "bulk-conflict" });
});

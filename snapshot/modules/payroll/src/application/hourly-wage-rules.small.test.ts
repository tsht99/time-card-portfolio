import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import test from "node:test";
import {
  createHourlyWageRuleManagementApplication,
  type HourlyWageRuleManagementApplication,
} from "./hourly-wage-rules.ts";
import type { HourlyWageRuleManagementRecord } from "./ports/hourly-wage-rule-ports.ts";

type CreateHourlyWageRuleTestInput = Parameters<
  HourlyWageRuleManagementApplication["createHourlyWageRule"]
>[0];
type CreateHourlyWageRulePersistenceTestInput = Omit<
  CreateHourlyWageRuleTestInput,
  "actorUserId"
>;

const staffId = "11111111-1111-4111-8111-111111111111";
const adminId = "88888888-8888-4888-8888-888888888888";
const otherAdminId = "99999999-9999-4999-8999-999999999999";
const unknownRoleUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const missingUserId = "22222222-2222-4222-8222-222222222222";
const rulesId = "33333333-3333-4333-8333-333333333333";
const missingRulesId = "44444444-4444-4444-8444-444444444444";

function rule(
  overrides: Partial<HourlyWageRuleManagementRecord> = {},
): HourlyWageRuleManagementRecord {
  return {
    id: rulesId,
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
      input: CreateHourlyWageRulePersistenceTestInput,
    ) => Promise<
      | { kind: "created"; hourlyWageRule: HourlyWageRuleManagementRecord }
      | { kind: "already-exists" }
    >;
    createdInputs?: unknown[];
  } = {},
) {
  const rules = [rule()];
  const roles: Record<string, string> = {
    [staffId]: "staff",
    [adminId]: "admin",
    [otherAdminId]: "admin",
    [unknownRoleUserId]: "unknown",
  };
  const statuses: Record<string, string> = {
    [staffId]: "active",
    [adminId]: "active",
    [otherAdminId]: "active",
    [unknownRoleUserId]: "active",
  };
  const calls = { create: 0, update: 0, delete: 0, bulk: 0, version: 0 };
  return {
    rules,
    roles,
    statuses,
    calls,
    application: createHourlyWageRuleManagementApplication({
      unitOfWork: {
        async run(operation) {
          return operation({
            users: {
              async getUserById(userId) {
                const role = roles[userId];
                return role
                  ? {
                      userId,
                      role: role as "staff" | "admin",
                      status: statuses[userId] ?? "active",
                      displayName: null,
                    }
                  : null;
              },
              async getUsers() {
                return [];
              },
            },
            hourlyWageRuleManagementPersistence: {
              async findAllForUser(userId) {
                return rules.filter((candidate) => candidate.userId === userId);
              },
              async create(input) {
                calls.create += 1;
                options.createdInputs?.push(input);
                return (
                  (await options.create?.(input)) ?? {
                    kind: "created" as const,
                    hourlyWageRule: rule({
                      id: "55555555-5555-4555-8555-555555555555",
                      ...input,
                    }),
                  }
                );
              },
              async update({
                userId,
                hourlyWageRuleId,
                expectedVersion,
                mutation,
              }) {
                calls.update += 1;
                const existing = rules.find(
                  (candidate) =>
                    candidate.userId === userId &&
                    candidate.id === hourlyWageRuleId,
                );
                if (!existing) return { kind: "rule-not-found" as const };
                if (existing.version !== expectedVersion)
                  return { kind: "version-conflict" as const };
                Object.assign(existing, mutation);
                existing.version += 1;
                return { kind: "updated" as const, hourlyWageRule: existing };
              },
              async delete({ userId, hourlyWageRuleId, expectedVersion }) {
                calls.delete += 1;
                const index = rules.findIndex(
                  (candidate) =>
                    candidate.userId === userId &&
                    candidate.id === hourlyWageRuleId,
                );
                const existing = rules[index];
                if (!existing) return { kind: "rule-not-found" as const };
                if (existing.version !== expectedVersion)
                  return { kind: "version-conflict" as const };
                const deletedId = rules.splice(index, 1)[0]?.id;
                return {
                  kind: "deleted" as const,
                  hourlyWageRuleId: deletedId ?? hourlyWageRuleId,
                };
              },
              async bulkUpdate(userId, _input, plan) {
                calls.bulk += 1;
                const planned = plan(
                  rules.filter((candidate) => candidate.userId === userId),
                );
                return planned.kind === "bulk-conflict"
                  ? planned
                  : { kind: "success" as const, hourlyWageRules: [] };
              },
            },
            hourlyWageRuleReadStore: {
              async findForPayrollEstimate() {
                return [];
              },
            },
          });
        },
      },
    }),
  };
}

test("時給ルール CRUD は成功結果を返し、更新対象は4項目だけ", async () => {
  const createdInputs: unknown[] = [];
  const { application, rules } = makeApplication({ createdInputs });
  strictEqual(
    (
      await application.createHourlyWageRule({
        ...rule(),
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
  strictEqual(
    (
      await application.getHourlyWageRules({
        actorUserId: adminId,
        userId: staffId,
      })
    ).kind,
    "success",
  );
  const updated = await application.updateHourlyWageRule({
    actorUserId: adminId,
    userId: staffId,
    hourlyWageRuleId: rulesId,
    expectedVersion: 1,
    workPeriod: "night",
    dayType: "holiday",
    hourlyWage: 1500,
    effectiveFrom: "2026-02-01",
  });
  deepStrictEqual(updated, {
    kind: "success",
    hourlyWageRule: rule({
      workPeriod: "night",
      dayType: "holiday",
      hourlyWage: 1500,
      effectiveFrom: "2026-02-01",
      version: 2,
    }),
  });
  deepStrictEqual(
    await application.updateHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRuleId: rulesId,
      expectedVersion: 1,
      workPeriod: "day",
      dayType: "sun",
      hourlyWage: 1600,
      effectiveFrom: "2026-03-01",
    }),
    { kind: "version-conflict" },
  );
  deepStrictEqual(
    rules[0],
    rule({
      workPeriod: "night",
      dayType: "holiday",
      hourlyWage: 1500,
      effectiveFrom: "2026-02-01",
      version: 2,
    }),
  );
  deepStrictEqual(
    await application.deleteHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRuleId: rulesId,
      expectedVersion: 1,
    }),
    { kind: "version-conflict" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRuleId: rulesId,
      expectedVersion: 2,
    }),
    { kind: "success", hourlyWageRuleId: rulesId },
  );
  strictEqual(rules.length, 0);
});

test("存在しない user と rules を区別し、時給一覧の順序を保つ", async () => {
  const { application, rules } = makeApplication();
  rules.push(
    rule({
      id: "66666666-6666-4666-8666-666666666666",
      workPeriod: "night",
      dayType: "sun",
      effectiveFrom: "2026-01-02",
    }),
    rule({
      id: "77777777-7777-4777-8777-777777777777",
      workPeriod: "day",
      dayType: "fri",
      effectiveFrom: "2026-01-03",
    }),
  );
  const listed = await application.getHourlyWageRules({
    actorUserId: adminId,
    userId: staffId,
  });
  if (listed.kind !== "success") throw new Error("Expected success.");
  deepStrictEqual(
    listed.hourlyWageRules.map(({ id }) => id),
    [
      "77777777-7777-4777-8777-777777777777",
      rulesId,
      "66666666-6666-4666-8666-666666666666",
    ],
  );
  deepStrictEqual(
    await application.getHourlyWageRules({
      actorUserId: adminId,
      userId: missingUserId,
    }),
    {
      kind: "user-not-found",
    },
  );
  deepStrictEqual(
    await application.updateHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRuleId: missingRulesId,
      expectedVersion: 1,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1,
      effectiveFrom: "2026-01-01",
    }),
    { kind: "rule-not-found" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRule({
      actorUserId: adminId,
      userId: staffId,
      hourlyWageRuleId: missingRulesId,
      expectedVersion: 1,
    }),
    { kind: "rule-not-found" },
  );
});

test("無効なactorは対象の存在を判別できず、staffやinactive adminは副作用なく拒否される", async () => {
  const { application, calls, statuses } = makeApplication();
  const readByStaff = await application.getHourlyWageRules({
    actorUserId: staffId,
    userId: staffId,
  });
  deepStrictEqual(readByStaff, { kind: "role-forbidden" });
  const inactiveAdminId = otherAdminId;
  statuses[inactiveAdminId] = "inactive";
  deepStrictEqual(
    await application.createHourlyWageRule({
      actorUserId: inactiveAdminId,
      userId: missingUserId,
      workPeriod: "day",
      dayType: "mon",
      hourlyWage: 1200,
      effectiveFrom: "2026-01-01",
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.getHourlyWageRules({
      actorUserId: inactiveAdminId,
      userId: staffId,
    }),
    { kind: "role-forbidden" },
  );
  strictEqual(calls.create, 0);
  strictEqual(calls.update, 0);
  strictEqual(calls.delete, 0);
  strictEqual(calls.bulk, 0);
});

test("管理対象のroleに基づいて時給変更を認可し、昇格後の既存ルールも保護する", async () => {
  const { application, calls, rules, roles } = makeApplication();
  const adminRulesId = "88888888-8888-4888-8888-888888888889";
  rules.push(rule({ id: adminRulesId, userId: adminId }));

  deepStrictEqual(
    await application.createHourlyWageRule({
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
    await application.updateHourlyWageRule({
      actorUserId: otherAdminId,
      userId: adminId,
      hourlyWageRuleId: adminRulesId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRule({
      actorUserId: otherAdminId,
      userId: adminId,
      hourlyWageRuleId: adminRulesId,
      expectedVersion: 1,
    }),
    { kind: "role-forbidden" },
  );
  strictEqual(calls.create, 0);
  strictEqual(calls.update, 0);
  strictEqual(calls.delete, 0);
  strictEqual(calls.version, 0);
  deepStrictEqual(
    rules.find(({ id }) => id === adminRulesId),
    rule({
      id: adminRulesId,
      userId: adminId,
    }),
  );
  strictEqual(
    (
      await application.getHourlyWageRules({
        actorUserId: adminId,
        userId: adminId,
      })
    ).kind,
    "success",
  );

  strictEqual(
    (
      await application.createHourlyWageRule({
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
    await application.updateHourlyWageRule({
      actorUserId: adminId,
      userId: adminId,
      hourlyWageRuleId: adminRulesId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    {
      kind: "success",
      hourlyWageRule: rule({
        id: adminRulesId,
        userId: adminId,
        workPeriod: "night",
        hourlyWage: 1300,
        effectiveFrom: "2026-02-01",
        version: 2,
      }),
    },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRule({
      actorUserId: adminId,
      userId: adminId,
      hourlyWageRuleId: adminRulesId,
      expectedVersion: 2,
    }),
    { kind: "success", hourlyWageRuleId: adminRulesId },
  );
  strictEqual(
    (
      await application.createHourlyWageRule({
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
    await application.updateHourlyWageRule({
      actorUserId: otherAdminId,
      userId: staffId,
      hourlyWageRuleId: rulesId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRule({
      actorUserId: otherAdminId,
      userId: staffId,
      hourlyWageRuleId: rulesId,
      expectedVersion: 1,
    }),
    { kind: "role-forbidden" },
  );
  deepStrictEqual(
    await application.updateHourlyWageRule({
      actorUserId: staffId,
      userId: staffId,
      hourlyWageRuleId: rulesId,
      expectedVersion: 1,
      workPeriod: "night",
      dayType: "mon",
      hourlyWage: 1300,
      effectiveFrom: "2026-02-01",
    }),
    {
      kind: "success",
      hourlyWageRule: rule({
        workPeriod: "night",
        dayType: "mon",
        hourlyWage: 1300,
        effectiveFrom: "2026-02-01",
        version: 2,
      }),
    },
  );
  deepStrictEqual(
    await application.deleteHourlyWageRule({
      actorUserId: staffId,
      userId: staffId,
      hourlyWageRuleId: rulesId,
      expectedVersion: 2,
    }),
    { kind: "success", hourlyWageRuleId: rulesId },
  );
  deepStrictEqual(
    await application.createHourlyWageRule({
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
    await duplicate.application.createHourlyWageRule({
      ...rule(),
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
      unexpected.application.createHourlyWageRule({
        ...rule(),
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
    await application.bulkUpdateHourlyWageRules({
      ...input,
      userId: missingUserId,
    }),
    { kind: "user-not-found" },
  );
  deepStrictEqual(
    await application.bulkUpdateHourlyWageRules({
      ...input,
      userId: otherAdminId,
    }),
    { kind: "role-forbidden" },
  );
  strictEqual(calls.bulk, 0);
  strictEqual(
    (
      await application.bulkUpdateHourlyWageRules({
        ...input,
        userId: staffId,
      })
    ).kind,
    "success",
  );
  strictEqual(
    (
      await application.bulkUpdateHourlyWageRules({
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
  const { planBulkHourlyWageRuleChanges } = await import(
    "./hourly-wage-rule-bulk.ts"
  );
  const existing = {
    id: rulesId,
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
  const plan = planBulkHourlyWageRuleChanges([existing, target, future], {
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
  const noOp = planBulkHourlyWageRuleChanges([existing, target], {
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
  const stale = planBulkHourlyWageRuleChanges([existing], {
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

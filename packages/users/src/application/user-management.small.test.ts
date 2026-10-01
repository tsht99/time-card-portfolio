import assert from "node:assert/strict";
import test from "node:test";

import type { UserState } from "../domain/user.ts";
import type {
  UserReader,
  UsersTransaction,
  UsersUnitOfWork,
} from "./ports/user-persistence.ts";
import {
  createUserManagementApplication,
  createUserReadApplication,
} from "./user-management.ts";

const staff: UserState = {
  userId: "staff",
  role: "staff",
  status: "active",
  displayName: "田中",
};

function makePorts(lockedUser: UserState | null = staff, conflict = false) {
  const calls: string[] = [];
  const users: UserReader = {
    async findById(userId) {
      calls.push(`find:${userId}`);
      return userId === staff.userId ? staff : null;
    },
    async list() {
      return [
        { ...staff, userId: "z", displayName: null },
        { ...staff, userId: "b", displayName: "あ" },
        { ...staff, userId: "a", displayName: "あ" },
      ];
    },
  };
  const transaction: UsersTransaction = {
    async lockUser(userId) {
      calls.push(`lock:${userId}`);
      return lockedUser;
    },
    async setStatus(userId, status) {
      calls.push(`status:${userId}:${status}`);
    },
    async setDisplayName(userId, name) {
      calls.push(`name:${userId}:${name}`);
    },
    async revokeSessions(userId) {
      calls.push(`revoke:${userId}`);
    },
    async issueSession() {
      throw new Error("unused");
    },
  };
  const unitOfWork: UsersUnitOfWork = {
    async run(operation) {
      calls.push("begin");
      const value = await operation(transaction);
      calls.push("commit");
      return conflict
        ? { ok: false, reason: "display-name-conflict" }
        : { ok: true, value };
    },
  };
  return { calls, users, unitOfWork };
}

test("公開 read boundary は User の role/status を返し、一覧を表示名順に並べる", async () => {
  const ports = makePorts();
  const application = createUserReadApplication(ports.users);
  assert.deepEqual(await application.getUserById("staff"), staff);
  assert.deepEqual(await application.getUserById("absent"), null);
  assert.deepEqual(
    (await application.getUsers()).map((user) => user.userId),
    ["a", "b", "z"],
  );
});

test("status は lock 後の最新状態で判定し、inactive 化と session revoke を同じ transaction で行う", async () => {
  const ports = makePorts();
  const result = await createUserManagementApplication(
    ports.users,
    ports.unitOfWork,
  ).updateUserStatus({ userId: staff.userId, status: "inactive" });
  assert.deepEqual(result, {
    kind: "success",
    userId: staff.userId,
    status: "inactive",
  });
  assert.deepEqual(ports.calls, [
    "begin",
    "lock:staff",
    "status:staff:inactive",
    "revoke:staff",
    "commit",
  ]);

  const reactivated = makePorts({ ...staff, status: "inactive" });
  assert.deepEqual(
    await createUserManagementApplication(
      reactivated.users,
      reactivated.unitOfWork,
    ).updateUserStatus({ userId: "staff", status: "active" }),
    { kind: "success", userId: "staff", status: "active" },
  );
  assert.equal(
    reactivated.calls.some((call) => call.startsWith("revoke:")),
    false,
  );
});

test("admin、禁止遷移、表示名欠落では status を保存しない", async () => {
  const cases = [
    {
      user: { ...staff, role: "admin" as const },
      target: "inactive" as const,
      reason: "role-forbidden",
    },
    {
      user: { ...staff, status: "pending" as const },
      target: "inactive" as const,
      reason: "transition-forbidden",
    },
    {
      user: { ...staff, status: "pending" as const, displayName: null },
      target: "active" as const,
      reason: "display-name-required",
    },
  ];
  for (const { user, target, reason } of cases) {
    const ports = makePorts(user);
    assert.deepEqual(
      await createUserManagementApplication(
        ports.users,
        ports.unitOfWork,
      ).updateUserStatus({ userId: staff.userId, status: target }),
      { kind: reason },
    );
    assert.deepEqual(ports.calls, ["begin", "lock:staff", "commit"]);
  }
});

test("表示名変更は本人/staff policy と trim を適用する", async () => {
  const ports = makePorts();
  assert.deepEqual(
    await createUserManagementApplication(
      ports.users,
      ports.unitOfWork,
    ).updateUserDisplayName({
      actorUserId: "admin",
      userId: "staff",
      displayName: "  佐藤  ",
    }),
    { kind: "success", userId: "staff", displayName: "佐藤" },
  );
  assert.deepEqual(ports.calls, [
    "begin",
    "lock:staff",
    "name:staff:佐藤",
    "commit",
  ]);

  const otherAdmin = makePorts({ ...staff, role: "admin" });
  assert.deepEqual(
    await createUserManagementApplication(
      otherAdmin.users,
      otherAdmin.unitOfWork,
    ).updateUserDisplayName({
      actorUserId: "other",
      userId: "staff",
      displayName: "佐藤",
    }),
    { kind: "role-forbidden" },
  );
  assert.equal(
    otherAdmin.calls.some((call) => call.startsWith("name:")),
    false,
  );

  const selfAdmin = makePorts({ ...staff, role: "admin" });
  assert.deepEqual(
    await createUserManagementApplication(
      selfAdmin.users,
      selfAdmin.unitOfWork,
    ).updateUserDisplayName({
      actorUserId: "staff",
      userId: "staff",
      displayName: "  管理者  ",
    }),
    { kind: "success", userId: "staff", displayName: "管理者" },
  );

  const empty = makePorts();
  assert.deepEqual(
    await createUserManagementApplication(
      empty.users,
      empty.unitOfWork,
    ).updateUserDisplayName({
      actorUserId: "admin",
      userId: "staff",
      displayName: "  ",
    }),
    { kind: "display-name-required" },
  );
  assert.deepEqual(
    await createUserManagementApplication(
      empty.users,
      empty.unitOfWork,
    ).updateUserDisplayName({
      actorUserId: "admin",
      userId: "staff",
      displayName: "\u00a0\u3000",
    }),
    { kind: "display-name-required" },
  );
  assert.equal(
    empty.calls.some((call) => call.startsWith("name:")),
    false,
  );
  assert.deepEqual(
    await createUserManagementApplication(
      empty.users,
      empty.unitOfWork,
    ).updateUserDisplayName({
      actorUserId: "admin",
      userId: "staff",
      displayName: "😀".repeat(101),
    }),
    { kind: "display-name-too-long" },
  );
});

test("user 不在と一意性競合を区別する", async () => {
  const missing = makePorts(null);
  assert.deepEqual(
    await createUserManagementApplication(
      missing.users,
      missing.unitOfWork,
    ).updateUserStatus({ userId: "absent", status: "active" }),
    { kind: "not-found" },
  );
  const conflict = makePorts(staff, true);
  assert.deepEqual(
    await createUserManagementApplication(
      conflict.users,
      conflict.unitOfWork,
    ).updateUserDisplayName({
      actorUserId: "admin",
      userId: "staff",
      displayName: "重複",
    }),
    { kind: "display-name-conflict" },
  );
});

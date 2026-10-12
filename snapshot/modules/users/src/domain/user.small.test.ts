import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageTargetUserData,
  canManageUsers,
  changeManagedDisplayName,
  changeStaffAccessStatus,
  isActiveAdmin,
  isActiveUserStatus,
  isUserAccessStatus,
  isUserRole,
  MAX_DISPLAY_NAME_CODE_POINTS,
  type UserAccessState,
} from "./user.ts";

const pendingStaff: UserAccessState = {
  userId: "staff",
  role: "staff",
  status: "pending",
  displayName: null,
};

test("表示名の上限は100コードポイント", () => {
  assert.equal(MAX_DISPLAY_NAME_CODE_POINTS, 100);
});

test("role と status を判別し、active user / admin を識別する", () => {
  assert.equal(isUserRole("staff"), true);
  assert.equal(isUserRole("unknown"), false);
  assert.equal(isUserAccessStatus("pending"), true);
  assert.equal(isUserAccessStatus("unknown"), false);
  assert.equal(isActiveUserStatus("active"), true);
  assert.equal(isActiveUserStatus("pending"), false);
  assert.equal(isActiveUserStatus("inactive"), false);
  assert.equal(isActiveAdmin("admin", "active"), true);
  assert.equal(isActiveAdmin("staff", "active"), false);
  assert.equal(isActiveAdmin("admin", "inactive"), false);
  assert.equal(canManageUsers("admin", "active"), true);
  assert.equal(canManageUsers("staff", "active"), false);
  assert.equal(canManageUsers("admin", "inactive"), false);
});

test("pending → active、active ↔ inactive のみを許可する", () => {
  const canChange = (
    current: UserAccessState["status"],
    target: UserAccessState["status"],
  ) =>
    changeStaffAccessStatus(
      { ...pendingStaff, status: current, displayName: "担当者" },
      target,
    ).ok;
  assert.equal(canChange("pending", "active"), true);
  assert.equal(canChange("active", "inactive"), true);
  assert.equal(canChange("inactive", "active"), true);
  assert.equal(canChange("active", "active"), true);
  assert.equal(canChange("inactive", "inactive"), true);
  assert.equal(canChange("pending", "pending"), false);
  assert.equal(canChange("pending", "inactive"), false);
  assert.equal(canChange("active", "pending"), false);
  assert.equal(canChange("inactive", "pending"), false);
});

test("staff は管理可能で、admin は本人だけ管理可能", () => {
  assert.equal(canManageTargetUserData("actor", "staff", "staff"), true);
  assert.equal(canManageTargetUserData("actor", "actor", "admin"), true);
  assert.equal(canManageTargetUserData("actor", "other", "admin"), false);
  assert.equal(canManageTargetUserData("actor", "other", "unknown"), false);
});

test("staff の有効化・停止には表示名が必要で、admin の通常 status 変更は拒否する", () => {
  assert.deepEqual(changeStaffAccessStatus(pendingStaff, "active"), {
    ok: false,
    reason: "display-name-required",
  });
  assert.deepEqual(changeStaffAccessStatus(pendingStaff, "inactive"), {
    ok: false,
    reason: "transition-forbidden",
  });
  assert.deepEqual(
    changeStaffAccessStatus({ ...pendingStaff, status: "active" }, "inactive"),
    { ok: false, reason: "display-name-required" },
  );
  assert.deepEqual(
    changeStaffAccessStatus(
      { ...pendingStaff, status: "inactive", displayName: " \t" },
      "inactive",
    ),
    { ok: false, reason: "display-name-required" },
  );
  assert.deepEqual(
    changeStaffAccessStatus({ ...pendingStaff, role: "admin" }, "active"),
    { ok: false, reason: "role-forbidden" },
  );

  const namedStaff = { ...pendingStaff, displayName: "担当者" };
  assert.deepEqual(changeStaffAccessStatus(namedStaff, "active"), {
    ok: true,
    user: { ...namedStaff, status: "active" },
  });
  assert.deepEqual(
    changeStaffAccessStatus({ ...namedStaff, status: "active" }, "inactive"),
    { ok: true, user: { ...namedStaff, status: "inactive" } },
  );
});

test("表示名は trim 後1〜100コードポイントで、絵文字を許可する", () => {
  assert.deepEqual(
    changeManagedDisplayName("actor", pendingStaff, "  田中  "),
    {
      ok: true,
      user: { ...pendingStaff, displayName: "田中" },
    },
  );
  assert.deepEqual(changeManagedDisplayName("actor", pendingStaff, "  "), {
    ok: false,
    reason: "display-name-required",
  });
  assert.deepEqual(
    changeManagedDisplayName("actor", pendingStaff, "\u00a0\u3000"),
    {
      ok: false,
      reason: "display-name-required",
    },
  );
  assert.deepEqual(changeManagedDisplayName("actor", pendingStaff, "  😀  "), {
    ok: true,
    user: { ...pendingStaff, displayName: "😀" },
  });
  assert.equal(
    changeManagedDisplayName("actor", pendingStaff, "😀".repeat(100)).ok,
    true,
  );
  assert.deepEqual(
    changeManagedDisplayName("actor", pendingStaff, "😀".repeat(101)),
    { ok: false, reason: "display-name-too-long" },
  );
  assert.deepEqual(
    changeStaffAccessStatus(
      { ...pendingStaff, displayName: "😀".repeat(101) },
      "active",
    ),
    { ok: false, reason: "display-name-too-long" },
  );
  for (const status of ["pending", "inactive"] as const) {
    assert.deepEqual(
      changeStaffAccessStatus(
        { ...pendingStaff, status, displayName: "\u00a0\u3000" },
        "active",
      ),
      { ok: false, reason: "display-name-required" },
    );
    assert.deepEqual(
      changeStaffAccessStatus(
        { ...pendingStaff, status, displayName: "😀".repeat(101) },
        "active",
      ),
      { ok: false, reason: "display-name-too-long" },
    );
  }
});

test("他 admin の表示名は変更できないが本人の表示名は変更できる", () => {
  const admin: UserAccessState = {
    ...pendingStaff,
    role: "admin",
    userId: "admin",
  };
  assert.deepEqual(changeManagedDisplayName("actor", admin, "新しい名前"), {
    ok: false,
    reason: "role-forbidden",
  });
  assert.deepEqual(changeManagedDisplayName("admin", admin, "  管理者  "), {
    ok: true,
    user: { ...admin, displayName: "管理者" },
  });
});

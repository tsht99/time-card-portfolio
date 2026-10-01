import assert from "node:assert/strict";
import test from "node:test";
import { isValidBranchName } from "./check-branch-name.mjs";

test("accepts shared, feature, and hotfix branch names", () => {
  for (const branchName of [
    "main",
    "develop",
    "feature/admin-tab-colors",
    "feature/244-admin-tab-colors",
    "feature/update-nextjs",
    "hotfix/login-failure",
    "hotfix/255-login-failure",
  ]) {
    assert.equal(isValidBranchName(branchName), true, branchName);
  }
});

test("rejects missing slugs, invalid issue notation, and unsupported prefixes", () => {
  for (const branchName of [
    "",
    "feature/",
    "feature/244",
    "hotfix/255",
    "feature/#244-admin-tab-colors",
    "fix/244-admin-tab-colors",
    "refactor/auth",
    "docs/update-manual",
    "chore/update-deps",
    "codex/244-admin-tab-colors",
  ]) {
    assert.equal(isValidBranchName(branchName), false, branchName);
  }
});

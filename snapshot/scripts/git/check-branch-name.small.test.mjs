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

test("accepts release branches with valid SemVer 2.0.0 versions", () => {
  for (const branchName of [
    "release/0.0.0",
    "release/2.0.0",
    "release/1.2.3",
    "release/10.20.30",
    "release/1.0.0-0",
    "release/1.0.0-alpha",
    "release/1.0.0-alpha.1",
    "release/2.0.0-alpha",
    "release/2.0.0-alpha.1",
    "release/2.0.0-beta.1",
    "release/2.0.0-rc.1",
    "release/1.0.0-0A.is-legal",
    "release/1.0.0+build.001",
    "release/1.0.0-alpha+build.7",
    "release/2.0.0-rc.1+build.2",
    "release/2.0.0+build.1",
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
    "release/",
    "release/v1.2.3",
    "release/01.2.3",
    "release/1.02.3",
    "release/1.2.03",
    "release/1.2",
    "release/1.2.3.4",
    "release/1.2.3-",
    "release/1.2.3-alpha..1",
    "release/1.2.3-01",
    "release/1.2.3+",
    "release/1.2.3+build..7",
    "release/1.2.3+build_7",
  ]) {
    assert.equal(isValidBranchName(branchName), false, branchName);
  }
});

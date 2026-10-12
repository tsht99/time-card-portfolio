import assert from "node:assert/strict";
import test from "node:test";
import {
  isExactDependencySpecifier,
  parseCatalogEntries,
} from "./dependency-version-policy.mjs";

test("dependency version policy accepts exact versions and supported workspace/catalog specifiers", () => {
  for (const specifier of [
    "1.2.3",
    "1.2.3-beta.1",
    "1.2.3+build.4",
    "workspace:*",
    "catalog:",
    "catalog:frontend-tooling",
  ]) {
    assert.equal(isExactDependencySpecifier(specifier), true, specifier);
  }
});

test("dependency version policy rejects ranges and non-exact aliases", () => {
  for (const specifier of [
    "^1.2.3",
    "~1.2.3",
    ">=1.2.3",
    "1.2",
    "latest",
    "catalog:bad name",
    "file:../local",
  ]) {
    assert.equal(isExactDependencySpecifier(specifier), false, specifier);
  }
});

test("pnpm catalog parser rejects rows it cannot parse", () => {
  assert.throws(
    () => parseCatalogEntries("catalog:\n  package-name: \n"),
    /Unable to parse pnpm-workspace.yaml catalog entry on line 2/u,
  );
});

test("pnpm catalog parser reads default and named catalog entries", () => {
  assert.deepEqual(
    parseCatalogEntries(
      "catalog:\n  'pkg-name': 1.2.3\ncatalogs:\n  tooling:\n    typescript: 5.9.3\n",
    ),
    [
      { name: "pkg-name", specifier: "1.2.3", location: "catalog", line: 2 },
      {
        name: "typescript",
        specifier: "5.9.3",
        location: "catalogs.tooling",
        line: 5,
      },
    ],
  );
});

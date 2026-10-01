import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function isAllowedSpecifier(specifier) {
  return (
    specifier === "workspace:*" ||
    specifier === "catalog:" ||
    /^catalog:[A-Za-z0-9_-]+$/u.test(specifier)
  );
}

function isExactDependencySpecifier(specifier) {
  return isAllowedSpecifier(specifier) || exactVersionPattern.test(specifier);
}

function parseCatalogEntries(yaml) {
  const entries = [];
  let section = null;
  let catalogName = null;

  for (const [index, rawLine] of yaml.split(/\r?\n/u).entries()) {
    if (!rawLine.trim() || /^\s*#/u.test(rawLine)) continue;
    const topLevel = /^(catalog|catalogs):\s*(?:#.*)?$/u.exec(rawLine);
    if (topLevel) {
      section = topLevel[1];
      catalogName = null;
      continue;
    }
    if (section === null) continue;

    const indent = rawLine.match(/^ */u)[0].length;
    const entryLine = rawLine.trim();
    if (section === "catalogs" && indent === 2) {
      const namedCatalog = /^([\w-]+):\s*(?:#.*)?$/u.exec(entryLine);
      if (!namedCatalog) {
        throw new Error(
          `Unable to parse pnpm-workspace.yaml named catalog on line ${index + 1}: ${entryLine}`,
        );
      }
      catalogName = namedCatalog[1];
      continue;
    }
    const expectedIndent = section === "catalog" ? 2 : 4;
    if (indent !== expectedIndent) {
      if (indent < expectedIndent) section = null;
      continue;
    }
    const match =
      /^(?:'((?:[^']|'')+)'|"([^"]+)"|([^:#][^:]*)):\s*(\S+)\s*(?:#.*)?$/u.exec(
        entryLine,
      );
    if (!match) {
      if (/^[^#][^:]*:\s*/u.test(entryLine)) {
        throw new Error(
          `Unable to parse pnpm-workspace.yaml catalog entry on line ${index + 1}: ${entryLine}`,
        );
      }
      continue;
    }
    const name = (match[1] ?? match[2] ?? match[3])
      .replaceAll("''", "'")
      .trim();
    entries.push({
      name,
      specifier: match[4],
      location: catalogName ? `catalogs.${catalogName}` : "catalog",
      line: index + 1,
    });
  }
  return entries;
}

async function packageManifestPaths(root) {
  const paths = [path.join(root, "package.json")];
  for (const workspaceDirectory of ["apps", "packages"]) {
    const directory = path.join(root, workspaceDirectory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory())
        paths.push(path.join(directory, entry.name, "package.json"));
    }
  }
  return paths;
}

async function collectViolations(root) {
  const violations = [];
  for (const manifestPath of await packageManifestPaths(root)) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const section of ["dependencies", "devDependencies"]) {
      for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
        if (!isExactDependencySpecifier(specifier)) {
          violations.push(
            `${path.relative(root, manifestPath)} ${section}.${name}=${specifier}`,
          );
        }
      }
    }
  }

  const workspacePath = path.join(root, "pnpm-workspace.yaml");
  const yaml = await readFile(workspacePath, "utf8");
  for (const entry of parseCatalogEntries(yaml)) {
    if (!exactVersionPattern.test(entry.specifier)) {
      violations.push(
        `pnpm-workspace.yaml ${entry.location}.${entry.name}=${entry.specifier} (line ${entry.line})`,
      );
    }
  }
  return violations;
}

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

test("all workspace dependency specs and pnpm catalog versions are exact", async () => {
  const violations = await collectViolations(repositoryRoot);
  assert.deepEqual(violations, []);
});

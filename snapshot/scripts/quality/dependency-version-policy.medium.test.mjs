import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  exactVersionPattern,
  isExactDependencySpecifier,
  parseCatalogEntries,
} from "./dependency-version-policy.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function packageManifestPaths(root) {
  const paths = [path.join(root, "package.json")];
  for (const workspaceDirectory of ["apps", "modules", "packages", "tools"]) {
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
  const yaml = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
  for (const entry of parseCatalogEntries(yaml)) {
    if (!exactVersionPattern.test(entry.specifier)) {
      violations.push(
        `pnpm-workspace.yaml ${entry.location}.${entry.name}=${entry.specifier} (line ${entry.line})`,
      );
    }
  }
  return violations;
}

test("all workspace dependency specs and pnpm catalog versions are exact", async () => {
  assert.deepEqual(await collectViolations(repositoryRoot), []);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const turboJson = JSON.parse(
  readFileSync(path.join(root, "turbo.json"), "utf8"),
);
const affectedRunner = readFileSync(
  path.join(root, "scripts/quality/run-affected-tests.mjs"),
  "utf8",
);

test("root Small Test scripts run root Small tests", () => {
  assert.equal(packageJson.scripts.test, undefined);
  assert.equal(turboJson.tasks.test, undefined);
  assert.match(
    packageJson.scripts["test:small:scripts"],
    /scripts\/\*\*\/\*\.small\.test\.mjs/u,
  );
  assert.match(
    packageJson.scripts["test:small"],
    /scripts\/\*\*\/\*\.small\.test\.mjs/u,
  );
  assert.equal(packageJson.scripts["test:small:affected"], undefined);
});

test("workspace Small and Medium Tests are cacheable", () => {
  assert.notEqual(turboJson.tasks["test:small"].cache, false);
  assert.notEqual(turboJson.tasks["test:medium"].cache, false);
});

test("workspace packages expose classified tests instead of generic test", () => {
  for (const directory of ["apps", "modules", "packages", "tools"]) {
    for (const workspace of readdirSync(path.join(root, directory), {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory())) {
      const manifestPath = path.join(
        root,
        directory,
        workspace.name,
        "package.json",
      );
      let workspaceManifest;
      try {
        workspaceManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      assert.equal(
        workspaceManifest.scripts?.test,
        undefined,
        `${directory}/${workspace.name} must use a classified test script`,
      );
    }
  }
});

test("root Medium Test scripts run root Medium tests", () => {
  assert.match(
    packageJson.scripts["test:medium"],
    /node --test "scripts\/\*\*\/\*\.medium\.test\.mjs" && node scripts\/quality\/run-medium-tests\.mjs/u,
  );
  assert.equal(packageJson.scripts["test:medium:affected"], undefined);
});

test("Quality and affected test commands retain root and workspace test paths", () => {
  assert.match(
    packageJson.scripts["test:small"],
    /scripts\/\*\*\/\*\.small\.test\.mjs.*turbo run test:small/u,
  );
  assert.match(
    packageJson.scripts["test:medium"],
    /scripts\/\*\*\/\*\.medium\.test\.mjs.*node scripts\/quality\/run-medium-tests\.mjs/u,
  );
  assert.equal(packageJson.scripts["test:small:affected"], undefined);
  assert.equal(packageJson.scripts["test:medium:affected"], undefined);
  assert.match(affectedRunner, /test:\$\{suffix\}:scripts/u);
  assert.match(affectedRunner, /test:\$\{suffix\}.*--affected/u);
  assert.match(affectedRunner, /--concurrency=1/u);
  assert.match(packageJson.scripts.quality, /run-quality\.mjs/u);
  assert.match(
    packageJson.scripts["quality:affected"],
    /quality-affected\.mjs/u,
  );
});

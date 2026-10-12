import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkEsmPolicy } from "./esm-policy.mjs";

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "timecard-esm-policy-"));
  await writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    'packages:\n  - "apps/*"\n',
  );
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  await writeFile(
    path.join(root, "apps", "web", "package.json"),
    '{"type":"module"}',
  );
  return root;
}

test("accepts ESM root and workspace packages and ignores generated output", async () => {
  const root = await makeFixture();
  try {
    await mkdir(path.join(root, "apps", "web", "node_modules", "vendor"), {
      recursive: true,
    });
    await mkdir(path.join(root, "apps", "web", "dist"), { recursive: true });
    await writeFile(
      path.join(root, "apps", "web", "node_modules", "vendor", "legacy.cjs"),
      "",
    );
    await writeFile(
      path.join(root, "apps", "web", "dist", "generated.cts"),
      "",
    );
    assert.deepEqual(await checkEsmPolicy(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports package type and self-authored CommonJS source violations", async () => {
  const root = await makeFixture();
  try {
    await writeFile(path.join(root, "package.json"), '{"type":"commonjs"}');
    await writeFile(
      path.join(root, "apps", "web", "package.json"),
      '{"type":"commonjs"}',
    );
    await writeFile(path.join(root, "apps", "web", "legacy.cts"), "");
    assert.deepEqual(await checkEsmPolicy(root), [
      './package.json: expected "type": "module"',
      'apps/web/package.json: expected "type": "module"',
      "apps/web/legacy.cts: self-authored .cjs/.cts source is not allowed",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

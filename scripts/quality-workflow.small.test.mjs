import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  path.join(repositoryRoot, ".github", "workflows-disabled", "quality.yml"),
  "utf8",
);

function stepBlock(name) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `step not found: ${name}`);

  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      (line.startsWith("      - name:") || /^ {2}[A-Za-z0-9_-]+:$/.test(line)),
  );
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

function jobBlock(name) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `job not found: ${name}`);

  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:$/.test(line),
  );
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

test("develop push uses the affected quality range from the push event", () => {
  const step = stepBlock("Quality for develop");

  assert.match(
    step,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/develop'/u,
  );
  assert.match(step, /run: pnpm quality:affected/u);
  assert.match(step, /TURBO_SCM_BASE: \$\{\{ github\.event\.before \}\}/u);
  assert.match(step, /TURBO_SCM_HEAD: \$\{\{ github\.sha \}\}/u);
});

test("main push and develop pull requests use full Quality without SCM env", () => {
  const step = stepBlock("Quality");

  assert.match(
    step,
    /if: github\.event_name != 'push' \|\| github\.ref != 'refs\/heads\/develop'/u,
  );
  assert.match(step, /run: pnpm quality\n/u);
  assert.doesNotMatch(step, /TURBO_SCM_(?:BASE|HEAD)/u);
  assert.doesNotMatch(step, /quality:affected/u);
});

test("build caches are disabled only for main pushes", () => {
  const expectedGuard =
    "if: github.event_name != 'push' || github.ref != 'refs/heads/main'";

  for (const name of [
    "Restore Turborepo cache",
    "Restore Next.js build cache",
  ]) {
    assert.ok(
      stepBlock(name).split("\n").includes(`        ${expectedGuard}`),
      `${name} must use the main-push cache guard`,
    );
  }
});

test("checkout and required setup and validation steps remain configured", () => {
  assert.match(stepBlock("Checkout"), /fetch-depth: 0/u);
  assert.match(
    stepBlock("Install dependencies"),
    /run: pnpm install --frozen-lockfile/u,
  );
  assert.match(
    stepBlock("Install Playwright Chromium Headless Shell"),
    /playwright install --with-deps --only-shell chromium/u,
  );
  assert.match(
    stepBlock("Validate Lefthook configuration"),
    /run: pnpm exec lefthook validate/u,
  );
});

test("commitlint and deployment quality gates remain restricted to successful pushes", () => {
  assert.match(
    stepBlock("Lint develop commit messages"),
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/develop'/u,
  );

  const preview = jobBlock("deploy-preview");
  assert.match(preview, /needs: quality/u);
  assert.match(
    preview,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/develop' && needs\.quality\.result == 'success'/u,
  );

  const production = jobBlock("deploy-production");
  assert.match(production, /needs: quality/u);
  assert.match(
    production,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && needs\.quality\.result == 'success'/u,
  );
});

test("removed develop quality command and affected main path are not present", () => {
  assert.doesNotMatch(workflow, /pnpm quality:develop/u);
  assert.doesNotMatch(stepBlock("Quality"), /quality:affected/u);
});

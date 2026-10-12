import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const workflowsDirectory = path.join(repositoryRoot, ".github", "workflows");
const readWorkflow = (name) =>
  readFileSync(path.join(workflowsDirectory, name), "utf8");
const quality = readWorkflow("quality.yml");
const production = readWorkflow("production-release.yml");
const daily = readWorkflow("daily-quality.yml");

function jobBlock(workflow, name) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `job not found: ${name}`);
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:$/.test(line),
  );
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

function stepBlock(workflow, jobName, name) {
  const job = jobBlock(workflow, jobName);
  const lines = job.split("\n");
  const start = lines.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `step not found: ${name}`);
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("      - name:"),
  );
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

test("normal Quality only triggers for develop PRs and pushes", () => {
  assert.match(
    quality,
    /on:\n {2}push:\n {4}branches:\n {6}- develop\n {2}pull_request:\n {4}branches:\n {6}- develop/u,
  );
  assert.doesNotMatch(quality, /- main/u);
  assert.doesNotMatch(quality, /schedule:|workflow_dispatch:/u);
  assert.match(
    stepBlock(quality, "quality", "Quality for affected changes"),
    /run: pnpm quality:affected/u,
  );
  assert.match(
    quality,
    /TURBO_SCM_BASE: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/u,
  );
  assert.match(quality, /TURBO_SCM_HEAD: \$\{\{ github\.sha \}\}/u);
  assert.match(quality, /fetch-depth: 0/u);
  assert.doesNotMatch(quality, /run: pnpm quality\n/u);
  assert.match(quality, /path: \.turbo/u);
  assert.match(quality, /path: apps\/web\/\.next\/cache/u);
  assert.doesNotMatch(quality, /actions\/cache@[\da-f]+[^\n]*\n {8}if:/u);
});

test("normal Quality keeps develop validation and independent Preview deployments", () => {
  assert.match(
    quality,
    /Lint develop commit messages\n {8}if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/develop'\n {8}run: node scripts\/git\/lint-push-commits\.mjs/u,
  );
  assert.match(
    quality,
    /mode=\$\(node scripts\/quality\/quality-affected\.mjs --mode\)/u,
  );
  assert.doesNotMatch(quality, /preview_migrations|Detect migration changes/u);
  for (const [jobName, group, projectVar, extraEnv, deployName] of [
    [
      "deploy-web-preview",
      "develop-web-preview-deploy",
      "VERCEL_PROJECT_ID",
      "",
      "Deploy Vercel Preview",
    ],
    [
      "deploy-help-preview",
      "develop-help-preview-deploy",
      "VERCEL_HELP_PROJECT_ID",
      "VERCEL_DEPLOYMENT_KIND: help",
      "Deploy Help Vercel Preview",
    ],
  ]) {
    const preview = jobBlock(quality, jobName);
    assert.match(preview, /needs: quality/u);
    assert.match(
      preview,
      /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/develop' && needs\.quality\.result == 'success'/u,
    );
    assert.match(preview, new RegExp(`group: ${group}`, "u"));
    assert.match(preview, /ref: \$\{\{ github\.sha \}\}/u);
    assert.match(
      preview,
      /git fetch --no-tags origin develop:refs\/remotes\/origin\/develop/u,
    );
    assert.match(preview, /current_sha.*GITHUB_SHA/u);
    assert.match(preview, /pnpm install --frozen-lockfile/u);
    assert.match(
      preview,
      new RegExp(
        `name: ${deployName}[\\s\\S]*node scripts/web/deploy-vercel-preview\\.mjs`,
        "u",
      ),
    );
    assert.match(
      preview,
      new RegExp(
        `VERCEL_PROJECT_ID: \\$\\{\\{ vars\\.${projectVar} \\}\\}`,
        "u",
      ),
    );
    if (extraEnv) assert.match(preview, new RegExp(extraEnv, "u"));
  }
  assert.doesNotMatch(quality, /deploy-preview:|pull_request.*deploy/u);
  assert.doesNotMatch(quality, /deploy-production:|deploy-help-production:/u);
});

test("production release triggers only on main push and runs clean full Quality", () => {
  assert.match(
    production,
    /^name: Production Release\n\non:\n {2}push:\n {4}branches:\n {6}- main\n/u,
  );
  assert.doesNotMatch(
    production,
    /pull_request:|workflow_dispatch:|schedule:/u,
  );
  const qualityJob = jobBlock(production, "quality");
  assert.match(
    stepBlock(production, "quality", "Checkout exact pushed revision"),
    /ref: \$\{\{ github\.sha \}\}/u,
  );
  assert.match(
    stepBlock(production, "quality", "Setup pnpm and Node.js"),
    /cache: true/u,
  );
  assert.match(
    stepBlock(production, "quality", "Setup Python for migration validation"),
    /actions\/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7\.0\.0/u,
  );
  assert.match(
    stepBlock(production, "quality", "Validate Lefthook configuration"),
    /pnpm exec lefthook validate/u,
  );
  assert.match(
    stepBlock(
      production,
      "quality",
      "Install Playwright Chromium Headless Shell",
    ),
    /playwright install --with-deps --only-shell chromium/u,
  );
  assert.match(
    stepBlock(production, "quality", "Quality"),
    /run: pnpm quality\n/u,
  );
  assert.doesNotMatch(
    qualityJob,
    /quality:affected|actions\/cache@|path: \.turbo|apps\/web\/\.next\/cache|TURBO_FORCE|--force/u,
  );
});

test("production deployments retain independent exact-SHA safety contracts", () => {
  for (const [jobName, script, concurrency] of [
    [
      "deploy-production",
      "web/deploy-vercel-production.mjs",
      "main-production-deploy",
    ],
    [
      "deploy-help-production",
      "web/deploy-help-production.mjs",
      "help-production-deploy",
    ],
  ]) {
    const job = jobBlock(production, jobName);
    assert.match(job, /needs: quality/u);
    assert.match(
      job,
      /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && needs\.quality\.result == 'success'/u,
    );
    assert.match(job, new RegExp(`group: ${concurrency}`, "u"));
    assert.match(job, /cancel-in-progress: false\n {6}queue: max/u);
    assert.match(job, /ref: \$\{\{ github\.sha \}\}/u);
    assert.match(
      job,
      /git fetch --no-tags origin main:refs\/remotes\/origin\/main/u,
    );
    assert.match(job, /current_sha.*GITHUB_SHA/u);
    assert.match(job, new RegExp(`node scripts/${script}`, "u"));

    const setupStep = stepBlock(production, jobName, "Setup pnpm and Node.js");
    const installStep = stepBlock(
      production,
      jobName,
      "Install deployment dependencies",
    );
    const deployStepName =
      jobName === "deploy-production"
        ? "Deploy Vercel Production"
        : "Deploy Help Vercel Production";
    const deployStep = stepBlock(production, jobName, deployStepName);
    const jobLines = job.split("\n");
    assert.ok(
      jobLines.indexOf(`      - name: Setup pnpm and Node.js`) <
        jobLines.indexOf(`      - name: Install deployment dependencies`) &&
        jobLines.indexOf(`      - name: Install deployment dependencies`) <
          jobLines.indexOf(`      - name: ${deployStepName}`),
      `${jobName} must install dependencies between setup and deployment`,
    );
    for (const step of [setupStep, installStep, deployStep]) {
      assert.match(step, /if: steps\.main-head\.outputs\.deploy == 'true'/u);
    }
    assert.match(installStep, /run: pnpm install --frozen-lockfile/u);
  }
  assert.doesNotMatch(
    production,
    /workflow_run:|uses: \.\/\.github\/workflows\//u,
  );
  assert.match(
    stepBlock(production, "deploy-production", "Deploy Vercel Production"),
    /VERCEL_PROJECT_ID: \$\{\{ vars\.VERCEL_PROJECT_ID \}\}/u,
  );
  assert.match(
    stepBlock(
      production,
      "deploy-help-production",
      "Deploy Help Vercel Production",
    ),
    /VERCEL_HELP_PROJECT_ID: \$\{\{ vars\.VERCEL_HELP_PROJECT_ID \}\}/u,
  );
});

test("weekly Saturday 04:30 JST full Quality workflow and pinned setup action references stay unchanged", () => {
  assert.match(
    daily,
    /^name: Daily Quality\n\non:\n {2}schedule:\n {4}- cron: "30 19 \* \* 5"\n {2}workflow_dispatch:/u,
  );
  assert.match(daily, /ref: develop/u);
  assert.match(daily, /cache: true/u);
  assert.match(daily, /run: pnpm quality\n/u);
  assert.match(daily, /playwright install --with-deps --only-shell chromium/u);
  assert.doesNotMatch(
    daily,
    /actions\/cache|\.turbo|apps\/web\/\.next\/cache|TURBO_FORCE|--force|deploy-/u,
  );
  for (const workflow of [quality, production, daily]) {
    assert.match(
      workflow,
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7/u,
    );
    assert.match(
      workflow,
      /pnpm\/setup@84cb39b217b10273981911c288cd62326dc7c6d2 # v2/u,
    );
  }
  for (const workflow of [quality, production, daily]) {
    assert.match(
      workflow,
      /actions\/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7\.0\.0/u,
    );
  }
});

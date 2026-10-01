import assert from "node:assert/strict";
import test from "node:test";
import { waitForReadyDeployment } from "./deploy-vercel-preview.mjs";
import {
  buildProductionDeploymentPayload,
  deployProduction,
  validateCheckout,
  validateEnvironment,
  validateProject,
  validateReadyDeployment,
} from "./deploy-vercel-production.mjs";

const githubSha = "0123456789abcdef0123456789abcdef01234567";
const validEnvironment = {
  GITHUB_SHA: githubSha,
  GITHUB_REF_NAME: "main",
  GITHUB_REPOSITORY: "tsht99/TimeCard",
  GITHUB_REPOSITORY_ID: "229701856",
  VERCEL_TOKEN: "token-is-only-a-test-value",
  VERCEL_ORG_ID: "team-test",
  VERCEL_PROJECT_ID: "project-test",
};
const validConfig = validateEnvironment(validEnvironment);
const project = {
  id: validConfig.vercelProjectId,
  name: "time-card",
  link: {
    type: "github",
    org: "tsht99",
    repo: "TimeCard",
    repoId: 229701856,
  },
};
const readyDeployment = {
  id: "dpl_test",
  url: "time-card.vercel.app",
  name: project.name,
  projectId: project.id,
  readyState: "READY",
  target: "production",
  gitSource: {
    type: "github",
    org: "tsht99",
    repo: "TimeCard",
    repoId: "229701856",
    ref: "main",
    sha: githubSha,
  },
};

function deploymentWithSource(source) {
  return {
    ...readyDeployment,
    gitSource: { ...readyDeployment.gitSource, ...source },
  };
}

function cleanGit({ head = githubSha, status = "" } = {}) {
  const calls = [];
  const execFileSync = (file, args) => {
    calls.push({ file, args });
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "status") return status;
    throw new Error("unexpected git command");
  };
  return { calls, execFileSync };
}

function createFetch({
  projectResponse = project,
  deploymentResponses = [readyDeployment, readyDeployment],
  createdResponse = { id: readyDeployment.id },
} = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => createdResponse,
      };
    }
    if (url.includes("/projects/")) {
      return {
        ok: true,
        status: 200,
        json: async () => projectResponse,
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => deploymentResponses.shift(),
    };
  };
  return { requests, fetchImpl };
}

test("validateEnvironment requires every production variable", () => {
  for (const key of Object.keys(validEnvironment)) {
    const missingEnvironment = { ...validEnvironment };
    delete missingEnvironment[key];
    assert.throws(
      () => validateEnvironment(missingEnvironment),
      new RegExp(key, "u"),
    );
  }
});

test("validateEnvironment accepts only main and valid SHA/repository identity", () => {
  for (const ref of ["master", "develop", "feature/test", "main/extra"]) {
    assert.throws(
      () => validateEnvironment({ ...validEnvironment, GITHUB_REF_NAME: ref }),
      /GITHUB_REF_NAMEはmain/u,
    );
  }
  for (const sha of ["abc", "g123456789abcdef0123456789abcdef01234567"]) {
    assert.throws(
      () => validateEnvironment({ ...validEnvironment, GITHUB_SHA: sha }),
      /40桁/u,
    );
  }
  for (const repository of ["TimeCard", "tsht99/Time Card", "/TimeCard"]) {
    assert.throws(
      () =>
        validateEnvironment({
          ...validEnvironment,
          GITHUB_REPOSITORY: repository,
        }),
      /owner\/repository/u,
    );
  }
});

test("validateCheckout permits only the exact SHA and clean tracked/untracked tree", () => {
  const git = cleanGit();
  assert.doesNotThrow(() =>
    validateCheckout({ githubSha, execFileSync: git.execFileSync }),
  );
  assert.deepEqual(git.calls, [
    { file: "git", args: ["rev-parse", "HEAD"] },
    {
      file: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
    },
  ]);

  assert.throws(
    () =>
      validateCheckout({
        githubSha,
        execFileSync: cleanGit({ head: "wrong" }).execFileSync,
      }),
    /HEADがGITHUB_SHA/u,
  );
  assert.throws(
    () =>
      validateCheckout({
        githubSha,
        execFileSync: cleanGit({ status: " M tracked.js\n?? untracked.js\n" })
          .execFileSync,
      }),
    /working treeがclean/u,
  );
});

test("project identity requires matching id, GitHub link, repository, and repoId", () => {
  assert.deepEqual(validateProject(project, validConfig), {
    id: project.id,
    name: project.name,
  });
  for (const projectResponse of [
    { ...project, id: "other-project" },
    { ...project, link: { ...project.link, type: "gitlab" } },
    { ...project, link: { ...project.link, org: "other-owner" } },
    { ...project, link: { ...project.link, repoId: "wrong-id" } },
    { ...project, link: { type: "github" } },
  ]) {
    assert.throws(
      () => validateProject(projectResponse, validConfig),
      /project|GitHub|identity/u,
    );
  }
});

test("buildProductionDeploymentPayload pins production, main, exact SHA, project, and repository", () => {
  const payload = buildProductionDeploymentPayload({
    ...validConfig,
    projectName: project.name,
  });
  assert.deepEqual(payload, {
    target: "production",
    project: validConfig.vercelProjectId,
    name: project.name,
    gitSource: {
      type: "github",
      org: "tsht99",
      repo: "TimeCard",
      ref: "main",
      sha: githubSha,
    },
  });
  assert.equal("files" in payload, false);
  assert.equal("prebuilt" in payload, false);
});

test("deployProduction validates checkout before any Vercel request", async () => {
  const git = cleanGit({ head: "wrong" });
  let fetchCalled = false;
  await assert.rejects(
    deployProduction({
      environment: validEnvironment,
      execFileSync: git.execFileSync,
      fetchImpl: async () => {
        fetchCalled = true;
      },
    }),
    /HEADがGITHUB_SHA/u,
  );
  assert.equal(fetchCalled, false);
});

test("deployProduction creates a clean production Git deployment with forceNew and revalidates READY metadata", async () => {
  const git = cleanGit();
  const { requests, fetchImpl } = createFetch({
    deploymentResponses: [
      { ...readyDeployment, readyState: "BUILDING" },
      readyDeployment,
      readyDeployment,
    ],
  });
  const result = await deployProduction({
    environment: validEnvironment,
    execFileSync: git.execFileSync,
    fetchImpl,
    pollIntervalMs: 1,
    sleep: async () => {},
  });
  const createRequest = requests.find(
    ({ options }) => options.method === "POST",
  );
  const body = JSON.parse(createRequest.options.body);
  const url = new URL(createRequest.url);
  assert.equal(url.searchParams.get("teamId"), validConfig.vercelOrgId);
  assert.equal(url.searchParams.get("forceNew"), "1");
  assert.equal(body.target, "production");
  assert.equal(body.project, validConfig.vercelProjectId);
  assert.equal(body.name, project.name);
  assert.equal(body.gitSource.ref, "main");
  assert.equal(body.gitSource.sha, githubSha);
  assert.deepEqual(
    { org: body.gitSource.org, repo: body.gitSource.repo },
    { org: "tsht99", repo: "TimeCard" },
  );
  assert.equal("files" in body, false);
  assert.equal("prebuilt" in body, false);
  assert.deepEqual(result, {
    deploymentId: readyDeployment.id,
    url: readyDeployment.url,
    sha: githubSha,
    ref: "main",
  });
});

test("deployProduction rejects project identity before creating a deployment", async () => {
  const git = cleanGit();
  const { requests, fetchImpl } = createFetch({
    projectResponse: {
      ...project,
      link: { ...project.link, repoId: "wrong-id" },
    },
  });
  await assert.rejects(
    deployProduction({
      environment: validEnvironment,
      execFileSync: git.execFileSync,
      fetchImpl,
    }),
    /identity/u,
  );
  assert.equal(
    requests.some(({ options }) => options.method === "POST"),
    false,
  );
});

test("validateReadyDeployment rejects mismatched production project or source metadata", () => {
  for (const deployment of [
    { ...readyDeployment, target: "preview" },
    { ...readyDeployment, projectId: "other-project" },
    { ...readyDeployment, name: "other-project" },
    deploymentWithSource({ sha: "wrong-sha" }),
    deploymentWithSource({ ref: "develop" }),
    deploymentWithSource({ org: "other-owner" }),
    deploymentWithSource({ repoId: "wrong-id" }),
    deploymentWithSource({
      org: undefined,
      repo: undefined,
      repoId: undefined,
    }),
    deploymentWithSource({ type: "gitlab" }),
  ]) {
    assert.throws(
      () => validateReadyDeployment(deployment, validConfig, project),
      /Production|project|source|identity/u,
    );
  }
});

test("waitForReadyDeployment rejects terminal failures and timeout", async () => {
  for (const state of [
    "ERROR",
    "CANCELED",
    "CANCELLED",
    "DELETED",
    "BLOCKED",
  ]) {
    await assert.rejects(
      waitForReadyDeployment({
        deploymentId: readyDeployment.id,
        getDeployment: async () => ({ readyState: state }),
      }),
      new RegExp(`state: ${state}`, "u"),
    );
  }

  let currentTime = 0;
  await assert.rejects(
    waitForReadyDeployment({
      deploymentId: readyDeployment.id,
      getDeployment: async () => ({ readyState: "BUILDING" }),
      timeoutMs: 1,
      pollIntervalMs: 1,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
    }),
    /タイムアウト/u,
  );
});

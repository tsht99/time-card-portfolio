import assert from "node:assert/strict";
import test from "node:test";
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
  GITHUB_REPOSITORY: "example-owner/current-repo",
  GITHUB_REPOSITORY_ID: "123456789",
  VERCEL_TOKEN: "token-is-only-a-test-value",
  VERCEL_ORG_ID: "team-test",
  VERCEL_PROJECT_ID: "project-test",
};
const validConfig = validateEnvironment(validEnvironment);
const project = {
  id: validConfig.vercelProjectId,
  name: "current-repo",
  link: {
    type: "github",
    org: "example-owner",
    repo: "current-repo",
    repoId: 123456789,
  },
};
const readyDeployment = {
  id: "dpl_test",
  url: "example-app.vercel.app",
  name: project.name,
  projectId: project.id,
  readyState: "READY",
  target: "production",
  gitSource: {
    type: "github",
    org: "example-owner",
    repo: "current-repo",
    repoId: "123456789",
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

function createClientFactory({
  projectResponse = project,
  deploymentResponses = [readyDeployment, readyDeployment],
  createdResponse = { id: readyDeployment.id },
} = {}) {
  const calls = [];
  const clientFactory = () => ({
    getProject: async (projectId) => {
      calls.push({ method: "getProject", projectId });
      return projectResponse;
    },
    createDeployment: async (payload, options) => {
      calls.push({ method: "createDeployment", payload, options });
      return createdResponse;
    },
    getDeployment: async (deploymentId) => {
      calls.push({ method: "getDeployment", deploymentId });
      return deploymentResponses.shift();
    },
  });
  return { calls, clientFactory };
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
  for (const repository of [
    "current-repo",
    "example-owner/invalid repository",
    "/current-repo",
  ]) {
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
    { ...project, link: { ...project.link, repoId: "987654321" } },
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
      org: "example-owner",
      repo: "current-repo",
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
  const { calls, clientFactory } = createClientFactory({
    deploymentResponses: [
      { ...readyDeployment, readyState: "BUILDING" },
      readyDeployment,
      readyDeployment,
    ],
  });
  const result = await deployProduction({
    environment: validEnvironment,
    execFileSync: git.execFileSync,
    clientFactory,
    pollIntervalMs: 1,
    sleep: async () => {},
  });
  const createCall = calls.find(({ method }) => method === "createDeployment");
  const body = createCall.payload;
  assert.deepEqual(createCall.options, { forceNew: true });
  assert.equal(body.target, "production");
  assert.equal(body.project, validConfig.vercelProjectId);
  assert.equal(body.name, project.name);
  assert.equal(body.gitSource.ref, "main");
  assert.equal(body.gitSource.sha, githubSha);
  assert.deepEqual(
    { org: body.gitSource.org, repo: body.gitSource.repo },
    { org: "example-owner", repo: "current-repo" },
  );
  assert.equal("files" in body, false);
  assert.equal("prebuilt" in body, false);
  assert.equal(
    calls.filter(({ method }) => method === "getDeployment").length,
    3,
  );
  assert.deepEqual(result, {
    deploymentId: readyDeployment.id,
    url: readyDeployment.url,
    sha: githubSha,
    ref: "main",
  });
});

test("deployProduction rejects project identity before creating a deployment", async () => {
  const git = cleanGit();
  const { calls, clientFactory } = createClientFactory({
    projectResponse: {
      ...project,
      link: { ...project.link, repoId: "987654321" },
    },
  });
  await assert.rejects(
    deployProduction({
      environment: validEnvironment,
      execFileSync: git.execFileSync,
      clientFactory,
    }),
    /identity/u,
  );
  assert.equal(
    calls.some(({ method }) => method === "createDeployment"),
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
    deploymentWithSource({ repoId: "987654321" }),
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

test("Help Production accepts either SDK or legacy project ID and rejects invalid identity", () => {
  const helpConfig = validateEnvironment({
    ...validEnvironment,
    VERCEL_DEPLOYMENT_KIND: "help",
  });
  const projectIdCases = [
    [{ project: { id: project.id } }, true],
    [{ projectId: project.id }, true],
    [{ project: { id: project.id }, projectId: project.id }, true],
    [{ project: { id: project.id }, projectId: "other-project" }, false],
    [{ projectId: "other-project" }, false],
    [{}, false],
    [{ project: { id: " " } }, false],
    [{ project: { id: 42 } }, false],
    [{ projectId: 42 }, false],
  ];

  for (const [identity, accepted] of projectIdCases) {
    const deployment = { ...readyDeployment, ...identity };
    if (!("projectId" in identity)) delete deployment.projectId;
    if (accepted) {
      assert.doesNotThrow(() =>
        validateReadyDeployment(deployment, helpConfig, project),
      );
    } else {
      assert.throws(
        () => validateReadyDeployment(deployment, helpConfig, project),
        /project id/u,
      );
    }
  }
});

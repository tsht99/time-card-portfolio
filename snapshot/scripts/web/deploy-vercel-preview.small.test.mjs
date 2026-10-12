import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeploymentPayload,
  deployPreview,
  validateEnvironment,
  validateReadyDeployment,
  waitForDevelopBranchAlias,
} from "./deploy-vercel-preview.mjs";

const validEnvironment = {
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_REF_NAME: "develop",
  GITHUB_REPOSITORY: "example-owner/current-repo",
  GITHUB_REPOSITORY_ID: "123456789",
  VERCEL_TOKEN: "token-is-only-a-test-value",
  VERCEL_ORG_ID: "team-test",
  VERCEL_PROJECT_ID: "project-test",
};
const validConfig = validateEnvironment(validEnvironment);

const developAlias = "current-repo-git-develop-example-owner.vercel.app";
const masterAlias = "current-repo-git-master-example-owner.vercel.app";
const readyDeployment = {
  id: "dpl_test",
  url: "example-app-preview.vercel.app",
  name: "current-repo",
  readyState: "READY",
  target: null,
  alias: [developAlias],
  automaticAliases: [developAlias],
  gitSource: {
    type: "github",
    org: "example-owner",
    repo: "current-repo",
    ref: "develop",
    sha: validConfig.githubSha,
  },
};
const aliases = {
  aliases: [{ alias: developAlias }],
};

function deploymentWithSource(source) {
  return {
    ...readyDeployment,
    gitSource: { ...readyDeployment.gitSource, ...source },
  };
}

test("buildDeploymentPayload pins exact SHA, develop source, repository, and project without production target", () => {
  const payload = buildDeploymentPayload({
    ...validConfig,
    projectName: "current-repo",
  });

  assert.deepEqual(payload.gitSource, {
    type: "github",
    org: "example-owner",
    repo: "current-repo",
    ref: "develop",
    sha: validConfig.githubSha,
  });
  assert.equal(payload.project, validConfig.vercelProjectId);
  assert.equal(payload.name, "current-repo");
  assert.equal("target" in payload, false);
});

test("validateEnvironment rejects a non-develop context and invalid repository", () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        GITHUB_REF_NAME: "feature/test",
      }),
    /GITHUB_REF_NAMEはdevelop/u,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        GITHUB_REPOSITORY: "current-repo",
      }),
    /owner\/repository/u,
  );
});

test("validateEnvironment rejects every missing required variable", () => {
  for (const key of Object.keys(validEnvironment)) {
    const missingEnvironment = { ...validEnvironment };
    delete missingEnvironment[key];
    assert.throws(
      () => validateEnvironment(missingEnvironment),
      new RegExp(key, "u"),
    );
  }
});

test("validateReadyDeployment rejects source SHA and ref mismatches", () => {
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({ sha: "wrong-sha" }),
        aliases,
        validConfig,
      ),
    /source SHA/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({ ref: "master" }),
        aliases,
        validConfig,
      ),
    /source ref/u,
  );
});

test("validateReadyDeployment rejects a mismatched GitHub source", () => {
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({ org: "other-owner" }),
        aliases,
        validConfig,
      ),
    /GitHub source/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({ type: "gitlab" }),
        aliases,
        validConfig,
      ),
    /GitHub source/u,
  );
});

test("validateReadyDeployment accepts GitHub repository identities from org/repo or repoId", () => {
  assert.doesNotThrow(() =>
    validateReadyDeployment(readyDeployment, aliases, validConfig),
  );
  assert.doesNotThrow(() =>
    validateReadyDeployment(
      deploymentWithSource({
        org: undefined,
        repo: undefined,
        repoId: "123456789",
      }),
      aliases,
      validConfig,
    ),
  );
  assert.doesNotThrow(() =>
    validateReadyDeployment(
      deploymentWithSource({
        org: undefined,
        repo: undefined,
        repoId: 123456789,
      }),
      aliases,
      validConfig,
    ),
  );
});

test("validateReadyDeployment rejects missing, mismatched, or conflicting GitHub repository identities", () => {
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({ org: undefined, repo: undefined }),
        aliases,
        validConfig,
      ),
    /repository identity/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({
          org: undefined,
          repo: undefined,
          repoId: "987654321",
        }),
        aliases,
        validConfig,
      ),
    /GitHub source/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({ repoId: "987654321" }),
        aliases,
        validConfig,
      ),
    /GitHub source/u,
  );
});

test("validateReadyDeployment requires an assigned develop branch alias in every source", () => {
  assert.throws(
    () =>
      validateReadyDeployment(
        { ...readyDeployment, alias: [] },
        aliases,
        validConfig,
      ),
    /branch alias/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(readyDeployment, { aliases: [] }, validConfig),
    /branch alias/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        { ...readyDeployment, automaticAliases: [] },
        aliases,
        validConfig,
      ),
    /branch alias/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        {
          ...readyDeployment,
          alias: [masterAlias],
          automaticAliases: [masterAlias],
        },
        { aliases: [{ alias: masterAlias }] },
        validConfig,
      ),
    /branch alias/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        { ...readyDeployment, automaticAliases: [masterAlias] },
        aliases,
        validConfig,
      ),
    /branch alias/u,
  );
});

test("validateReadyDeployment rejects production deployments", () => {
  assert.throws(
    () =>
      validateReadyDeployment(
        { ...readyDeployment, target: "production" },
        aliases,
        validConfig,
      ),
    /Production deployment/u,
  );
});

test("waitForDevelopBranchAlias succeeds immediately when the alias is present", async () => {
  let sleeps = 0;
  const result = await waitForDevelopBranchAlias({
    deploymentId: readyDeployment.id,
    getDeployment: async () => readyDeployment,
    listDeploymentAliases: async () => aliases,
    config: validConfig,
    sleep: async () => {
      sleeps += 1;
    },
  });
  assert.equal(result.alias, developAlias);
  assert.equal(sleeps, 0);
});

test("waitForDevelopBranchAlias refetches metadata and aliases until the alias appears", async () => {
  let metadataCalls = 0;
  let aliasCalls = 0;
  let sleeps = 0;
  const result = await waitForDevelopBranchAlias({
    deploymentId: readyDeployment.id,
    getDeployment: async () => {
      metadataCalls += 1;
      return readyDeployment;
    },
    listDeploymentAliases: async () => {
      aliasCalls += 1;
      return aliasCalls === 1 ? { aliases: [] } : aliases;
    },
    config: validConfig,
    pollIntervalMs: 5_000,
    sleep: async () => {
      sleeps += 1;
    },
  });
  assert.equal(result.alias, developAlias);
  assert.equal(metadataCalls, 2);
  assert.equal(aliasCalls, 2);
  assert.equal(sleeps, 1);
});

test("waitForDevelopBranchAlias times out after 30 seconds of virtual time", async () => {
  let currentTime = 0;
  let metadataCalls = 0;
  let aliasCalls = 0;
  await assert.rejects(
    waitForDevelopBranchAlias({
      deploymentId: readyDeployment.id,
      getDeployment: async () => {
        metadataCalls += 1;
        return readyDeployment;
      },
      listDeploymentAliases: async () => {
        aliasCalls += 1;
        return { aliases: [] };
      },
      config: validConfig,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
    }),
    /branch aliasの待機がタイムアウト/u,
  );
  assert.equal(currentTime, 30_000);
  assert.equal(metadataCalls, 7);
  assert.equal(aliasCalls, 7);
});

test("waitForDevelopBranchAlias fails metadata mismatches without waiting for an alias", async () => {
  for (const [deployment, pattern] of [
    [deploymentWithSource({ sha: "wrong-sha" }), /source SHA/u],
    [deploymentWithSource({ ref: "master" }), /source ref/u],
    [deploymentWithSource({ repoId: "987654321" }), /GitHub source/u],
    [{ ...readyDeployment, target: "production" }, /Production deployment/u],
  ]) {
    let aliasesFetched = false;
    let slept = false;
    await assert.rejects(
      waitForDevelopBranchAlias({
        deploymentId: readyDeployment.id,
        getDeployment: async () => deployment,
        listDeploymentAliases: async () => {
          aliasesFetched = true;
          return { aliases: [] };
        },
        config: validConfig,
        sleep: async () => {
          slept = true;
        },
      }),
      pattern,
    );
    assert.equal(aliasesFetched, false);
    assert.equal(slept, false);
  }
});

test("deployPreview posts exact SHA and ref, waits, refetches repoId metadata, and validates aliases", async () => {
  const readyDeploymentWithRepoId = deploymentWithSource({
    org: undefined,
    repo: undefined,
    repoId: 123456789,
  });
  const metadataResponses = [
    { ...readyDeployment, readyState: "BUILDING" },
    readyDeploymentWithRepoId,
    readyDeploymentWithRepoId,
  ];
  const calls = [];
  const clientFactory = () => ({
    getProject: async (projectId) => {
      calls.push({ method: "getProject", projectId });
      return { name: "current-repo" };
    },
    createDeployment: async (payload, options) => {
      calls.push({ method: "createDeployment", payload, options });
      return { id: readyDeployment.id };
    },
    getDeployment: async (deploymentId) => {
      calls.push({ method: "getDeployment", deploymentId });
      return metadataResponses.shift();
    },
    listDeploymentAliases: async (deploymentId) => {
      calls.push({ method: "listDeploymentAliases", deploymentId });
      return aliases;
    },
  });

  const result = await deployPreview({
    environment: validEnvironment,
    clientFactory,
    pollIntervalMs: 1,
    sleep: async () => {},
  });
  const createCall = calls.find(({ method }) => method === "createDeployment");
  const body = createCall.payload;
  assert.equal(body.gitSource.sha, validConfig.githubSha);
  assert.equal(body.gitSource.ref, "develop");
  assert.equal(body.gitSource.org, "example-owner");
  assert.equal(body.gitSource.repo, "current-repo");
  assert.equal(body.project, validConfig.vercelProjectId);
  assert.equal(body.name, "current-repo");
  assert.equal("target" in body, false);
  assert.deepEqual(createCall.options, undefined);
  assert.equal(result.alias, developAlias);
  assert.equal(
    calls.filter(({ method }) => method === "getDeployment").length,
    3,
  );
  assert.equal(
    calls.filter(({ method }) => method === "listDeploymentAliases").length,
    1,
  );
});

test("Help Preview validates SDK and legacy project IDs in the actual deploy path", async () => {
  const helpEnvironment = {
    ...validEnvironment,
    VERCEL_DEPLOYMENT_KIND: "help",
  };
  const helpProject = {
    id: validConfig.vercelProjectId,
    name: "current-repo",
    link: { type: "github", repoId: "123456789" },
  };
  const ids = [
    [{ project: { id: validConfig.vercelProjectId } }, true],
    [{ projectId: validConfig.vercelProjectId }, true],
    [
      {
        project: { id: validConfig.vercelProjectId },
        projectId: validConfig.vercelProjectId,
      },
      true,
    ],
    [
      {
        project: { id: validConfig.vercelProjectId },
        projectId: "other-project",
      },
      false,
    ],
    [{ projectId: "other-project" }, false],
    [{}, false],
    [{ project: { id: " " } }, false],
    [{ project: { id: 42 } }, false],
    [{ projectId: 42 }, false],
  ];

  for (const [identity, accepted] of ids) {
    const deployment = {
      ...readyDeployment,
      id: "dpl_help",
      projectId: undefined,
      gitSource: { ...readyDeployment.gitSource, repoId: "123456789" },
      ...identity,
    };
    const calls = [];
    const clientFactory = () => ({
      getProject: async () => helpProject,
      createDeployment: async () => ({ id: "dpl_help" }),
      getDeployment: async () => {
        calls.push("getDeployment");
        return deployment;
      },
    });

    if (accepted) {
      const result = await deployPreview({
        environment: helpEnvironment,
        clientFactory,
        sleep: async () => {},
      });
      assert.equal(result.deploymentId, "dpl_help");
      assert.equal(calls.length, 2);
    } else {
      await assert.rejects(
        deployPreview({
          environment: helpEnvironment,
          clientFactory,
          sleep: async () => {},
        }),
        /project id/u,
      );
      assert.equal(calls.length, 2);
    }
  }
});

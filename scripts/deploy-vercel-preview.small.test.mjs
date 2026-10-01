import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeploymentPayload,
  deployPreview,
  validateEnvironment,
  validateReadyDeployment,
  waitForDevelopBranchAlias,
  waitForReadyDeployment,
} from "./deploy-vercel-preview.mjs";

const validEnvironment = {
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_REF_NAME: "develop",
  GITHUB_REPOSITORY: "tsht99/TimeCard",
  GITHUB_REPOSITORY_ID: "229701856",
  VERCEL_TOKEN: "token-is-only-a-test-value",
  VERCEL_ORG_ID: "team-test",
  VERCEL_PROJECT_ID: "project-test",
};
const validConfig = validateEnvironment(validEnvironment);

const developAlias = "time-card-git-develop-tsht99.vercel.app";
const masterAlias = "time-card-git-master-tsht99.vercel.app";
const readyDeployment = {
  id: "dpl_test",
  url: "timecard-preview.vercel.app",
  name: "time-card",
  readyState: "READY",
  target: null,
  alias: [developAlias],
  automaticAliases: [developAlias],
  gitSource: {
    type: "github",
    org: "tsht99",
    repo: "TimeCard",
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
    projectName: "time-card",
  });

  assert.deepEqual(payload.gitSource, {
    type: "github",
    org: "tsht99",
    repo: "TimeCard",
    ref: "develop",
    sha: validConfig.githubSha,
  });
  assert.equal(payload.project, validConfig.vercelProjectId);
  assert.equal(payload.name, "time-card");
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
        GITHUB_REPOSITORY: "TimeCard",
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
        repoId: "229701856",
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
        repoId: 229701856,
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
          repoId: "wrong-id",
        }),
        aliases,
        validConfig,
      ),
    /GitHub source/u,
  );
  assert.throws(
    () =>
      validateReadyDeployment(
        deploymentWithSource({ repoId: "wrong-id" }),
        aliases,
        validConfig,
      ),
    /GitHub source/u,
  );
});

test("waitForReadyDeployment rejects every terminal failure state", async () => {
  for (const state of [
    "ERROR",
    "CANCELED",
    "CANCELLED",
    "DELETED",
    "BLOCKED",
  ]) {
    await assert.rejects(
      waitForReadyDeployment({
        deploymentId: "dpl_test",
        getDeployment: async () => ({ readyState: state }),
      }),
      new RegExp(`state: ${state}`, "u"),
    );
  }
});

test("waitForReadyDeployment stops at its injectable timeout", async () => {
  let currentTime = 0;
  await assert.rejects(
    waitForReadyDeployment({
      deploymentId: "dpl_test",
      getDeployment: async () => ({ readyState: "BUILDING" }),
      timeoutMs: 10,
      pollIntervalMs: 10,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
    }),
    /タイムアウト/u,
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
    [deploymentWithSource({ repoId: "wrong-id" }), /GitHub source/u],
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
  const requests = [];
  const readyDeploymentWithRepoId = deploymentWithSource({
    org: undefined,
    repo: undefined,
    repoId: 229701856,
  });
  const metadataResponses = [
    { ...readyDeployment, readyState: "BUILDING" },
    readyDeploymentWithRepoId,
    readyDeploymentWithRepoId,
  ];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: readyDeployment.id }),
      };
    }
    if (url.includes("/aliases")) {
      return { ok: true, status: 200, json: async () => aliases };
    }
    if (url.includes("/projects/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: "time-card" }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => metadataResponses.shift(),
    };
  };

  const result = await deployPreview({
    environment: validEnvironment,
    fetchImpl,
    pollIntervalMs: 1,
    sleep: async () => {},
  });
  const createRequest = requests.find(
    ({ options }) => options.method === "POST",
  );
  const body = JSON.parse(createRequest.options.body);
  assert.equal(body.gitSource.sha, validConfig.githubSha);
  assert.equal(body.gitSource.ref, "develop");
  assert.equal(body.gitSource.org, "tsht99");
  assert.equal(body.gitSource.repo, "TimeCard");
  assert.equal(body.project, validConfig.vercelProjectId);
  assert.equal(body.name, "time-card");
  assert.equal("target" in body, false);
  assert.equal(
    new URL(createRequest.url).searchParams.get("teamId"),
    "team-test",
  );
  assert.equal(new URL(createRequest.url).searchParams.has("forceNew"), false);
  assert.equal(result.alias, developAlias);
  assert.equal(
    requests.filter(({ options }) => options.method === "GET").length,
    5,
  );
});

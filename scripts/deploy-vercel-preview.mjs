import path from "node:path";
import { fileURLToPath } from "node:url";

const VERCEL_API_URL = "https://api.vercel.com";
const DEVELOP_BRANCH = "develop";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const ALIAS_TIMEOUT_MS = 30 * 1_000;
const REQUEST_TIMEOUT_MS = 30 * 1_000;
const REQUIRED_ENVIRONMENT = [
  "GITHUB_SHA",
  "GITHUB_REF_NAME",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
];
const TERMINAL_FAILURE_STATES = new Set([
  "ERROR",
  "CANCELED",
  "CANCELLED",
  "DELETED",
  "BLOCKED",
]);

function requiredValue(environment, key) {
  const value = environment?.[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export function validateEnvironment(environment) {
  const missing = REQUIRED_ENVIRONMENT.filter(
    (key) => requiredValue(environment, key) === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`必要な環境変数がありません: ${missing.join(", ")}`);
  }

  const refName = requiredValue(environment, "GITHUB_REF_NAME");
  if (refName !== DEVELOP_BRANCH) {
    throw new Error("GITHUB_REF_NAMEはdevelopである必要があります。");
  }

  const repository = requiredValue(environment, "GITHUB_REPOSITORY");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error(
      "GITHUB_REPOSITORYはowner/repository形式である必要があります。",
    );
  }

  return {
    githubSha: requiredValue(environment, "GITHUB_SHA"),
    githubRepository: repository,
    githubRepositoryId: requiredValue(environment, "GITHUB_REPOSITORY_ID"),
    vercelToken: requiredValue(environment, "VERCEL_TOKEN"),
    vercelOrgId: requiredValue(environment, "VERCEL_ORG_ID"),
    vercelProjectId: requiredValue(environment, "VERCEL_PROJECT_ID"),
  };
}

export function buildDeploymentPayload({
  githubSha,
  githubRepository,
  vercelProjectId,
  projectName,
}) {
  const repositorySeparator = githubRepository.indexOf("/");
  const repositoryOwner = githubRepository.slice(0, repositorySeparator);
  const repositoryName = githubRepository.slice(repositorySeparator + 1);

  return {
    name: projectName,
    project: vercelProjectId,
    gitSource: {
      type: "github",
      org: repositoryOwner,
      repo: repositoryName,
      ref: DEVELOP_BRANCH,
      sha: githubSha,
    },
  };
}

function requestTimeoutSignal() {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  return undefined;
}

async function requestJson(fetchImpl, url, options) {
  let response;
  try {
    const signal = requestTimeoutSignal();
    response = await fetchImpl(url, {
      ...options,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw new Error("Vercel APIへのリクエストに失敗しました。", {
      cause: error,
    });
  }

  if (!response?.ok) {
    throw new Error(
      `Vercel APIがHTTP ${response?.status ?? "unknown"}を返しました。`,
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(
      "Vercel APIのレスポンスをJSONとして読み取れませんでした。",
      {
        cause: error,
      },
    );
  }
}

export function createVercelClient({
  token,
  orgId,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchが利用できません。");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const teamQuery = `teamId=${encodeURIComponent(orgId)}`;

  return {
    createDeployment(payload, options = {}) {
      const forceNewQuery = options?.forceNew === true ? "&forceNew=1" : "";
      return requestJson(
        fetchImpl,
        `${VERCEL_API_URL}/v13/deployments?${teamQuery}${forceNewQuery}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
      );
    },
    getDeployment(deploymentId) {
      return requestJson(
        fetchImpl,
        `${VERCEL_API_URL}/v13/deployments/${encodeURIComponent(
          deploymentId,
        )}?withGitRepoInfo=true&${teamQuery}`,
        { method: "GET", headers },
      );
    },
    getProject(projectId) {
      return requestJson(
        fetchImpl,
        `${VERCEL_API_URL}/v9/projects/${encodeURIComponent(
          projectId,
        )}?${teamQuery}`,
        { method: "GET", headers },
      );
    },
    listDeploymentAliases(deploymentId) {
      return requestJson(
        fetchImpl,
        `${VERCEL_API_URL}/v2/deployments/${encodeURIComponent(
          deploymentId,
        )}/aliases?${teamQuery}`,
        { method: "GET", headers },
      );
    },
  };
}

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function waitForReadyDeployment({
  deploymentId,
  getDeployment,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleep: sleepImpl = sleep,
  now = Date.now,
}) {
  const startedAt = now();

  while (true) {
    const deployment = await getDeployment(deploymentId);
    const state = deployment?.readyState;
    if (state === "READY") return deployment;
    if (TERMINAL_FAILURE_STATES.has(state)) {
      throw new Error(`Vercel deploymentが失敗しました (state: ${state})。`);
    }

    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error("Vercel deploymentの待機がタイムアウトしました。");
    }
    await sleepImpl(Math.min(pollIntervalMs, remainingMs));
  }
}

function aliasNames(aliasResponse) {
  if (!Array.isArray(aliasResponse?.aliases)) return [];
  return aliasResponse.aliases
    .map((entry) => (typeof entry === "string" ? entry : entry?.alias))
    .filter((alias) => typeof alias === "string" && alias !== "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isDevelopBranchAlias(alias, projectName) {
  if (typeof projectName !== "string" || projectName === "") return false;
  const projectPrefix = escapeRegExp(projectName);
  return new RegExp(
    `^${projectPrefix}-git-${DEVELOP_BRANCH}-[a-z0-9-]+\\.vercel\\.app$`,
    "u",
  ).test(alias);
}

function validateReadyDeploymentMetadata(
  deployment,
  { githubSha, githubRepository, githubRepositoryId },
) {
  if (deployment?.readyState !== "READY") {
    throw new Error("READYではないdeploymentを成功扱いできません。");
  }
  if (deployment.target === "production") {
    throw new Error("Production deploymentを成功扱いできません。");
  }

  const gitSource = deployment.gitSource;
  if (gitSource?.sha !== githubSha) {
    throw new Error(
      "Vercel deploymentのsource SHAがGITHUB_SHAと一致しません。",
    );
  }
  if (gitSource?.ref !== DEVELOP_BRANCH) {
    throw new Error("Vercel deploymentのsource refがdevelopと一致しません。");
  }

  const repositorySeparator = githubRepository.indexOf("/");
  const repositoryOwner = githubRepository.slice(0, repositorySeparator);
  const repositoryName = githubRepository.slice(repositorySeparator + 1);
  if (gitSource?.type !== "github") {
    throw new Error("Vercel deploymentのGitHub sourceが想定と一致しません。");
  }

  const hasOrgOrRepo =
    gitSource.org !== undefined || gitSource.repo !== undefined;
  const hasRepoId = gitSource.repoId !== undefined && gitSource.repoId !== null;
  if (!hasOrgOrRepo && !hasRepoId) {
    throw new Error(
      "Vercel deploymentのGitHub repository identityがありません。",
    );
  }

  const orgAndRepoMatch =
    !hasOrgOrRepo ||
    (gitSource.org === repositoryOwner && gitSource.repo === repositoryName);
  const repoIdMatches =
    !hasRepoId ||
    ((typeof gitSource.repoId === "string" ||
      typeof gitSource.repoId === "number") &&
      String(gitSource.repoId) === githubRepositoryId);
  if (!orgAndRepoMatch || !repoIdMatches) {
    throw new Error("Vercel deploymentのGitHub sourceが想定と一致しません。");
  }

  return gitSource;
}

function findDevelopBranchAlias(deployment, aliases) {
  const assignedAliases = aliasNames(aliases);
  const deploymentAliases = Array.isArray(deployment.alias)
    ? deployment.alias.filter(
        (alias) => typeof alias === "string" && alias !== "",
      )
    : [];
  const automaticAliases = Array.isArray(deployment.automaticAliases)
    ? deployment.automaticAliases.filter(
        (alias) => typeof alias === "string" && alias !== "",
      )
    : [];
  const projectName = deployment.name;
  const branchAlias = assignedAliases.find(
    (alias) =>
      deploymentAliases.includes(alias) &&
      automaticAliases.includes(alias) &&
      isDevelopBranchAlias(alias, projectName),
  );

  return branchAlias;
}

export function validateReadyDeployment(deployment, aliases, config) {
  const gitSource = validateReadyDeploymentMetadata(deployment, config);
  const branchAlias = findDevelopBranchAlias(deployment, aliases);
  if (branchAlias === undefined) {
    throw new Error(
      "develop branch aliasがdeploymentに割り当てられていません。",
    );
  }

  return {
    deploymentId: deployment.id,
    url: deployment.url,
    alias: branchAlias,
    sha: gitSource.sha,
    ref: gitSource.ref,
  };
}

export async function waitForDevelopBranchAlias({
  deploymentId,
  getDeployment,
  listDeploymentAliases,
  config,
  timeoutMs = ALIAS_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleep: sleepImpl = sleep,
  now = Date.now,
}) {
  const startedAt = now();
  while (true) {
    const deployment = await getDeployment(deploymentId);
    validateReadyDeploymentMetadata(deployment, config);
    const aliases = await listDeploymentAliases(deploymentId);
    const result = findDevelopBranchAlias(deployment, aliases);
    if (result !== undefined) {
      return validateReadyDeployment(deployment, aliases, config);
    }

    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error("develop branch aliasの待機がタイムアウトしました。");
    }
    await sleepImpl(Math.min(pollIntervalMs, remainingMs));
  }
}

export async function deployPreview({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleep: sleepImpl = sleep,
  now = Date.now,
} = {}) {
  const config = validateEnvironment(environment);
  const client = createVercelClient({
    token: config.vercelToken,
    orgId: config.vercelOrgId,
    fetchImpl,
  });
  const project = await client.getProject(config.vercelProjectId);
  if (typeof project?.name !== "string" || project.name.trim() === "") {
    throw new Error("Vercel project metadataにnameがありません。");
  }
  const created = await client.createDeployment(
    buildDeploymentPayload({ ...config, projectName: project.name }),
  );
  if (typeof created?.id !== "string" || created.id === "") {
    throw new Error("Vercel APIのdeployment IDがありません。");
  }

  await waitForReadyDeployment({
    deploymentId: created.id,
    getDeployment: client.getDeployment,
    timeoutMs,
    pollIntervalMs,
    sleep: sleepImpl,
    now,
  });
  return waitForDevelopBranchAlias({
    deploymentId: created.id,
    getDeployment: client.getDeployment,
    listDeploymentAliases: client.listDeploymentAliases,
    config,
    timeoutMs: ALIAS_TIMEOUT_MS,
    pollIntervalMs,
    sleep: sleepImpl,
    now,
  });
}

export async function main() {
  const result = await deployPreview();
  console.log(
    `Vercel Preview deployment READY: ${result.url} (alias: ${result.alias}, ref: ${result.ref}, sha: ${result.sha})`,
  );
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Vercel deploymentに失敗しました。",
    );
    process.exitCode = 1;
  }
}

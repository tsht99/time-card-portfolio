import { HTTPClient, Vercel } from "@vercel/sdk";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 30 * 1_000;
const TERMINAL_FAILURE_STATES = new Set([
  "ERROR",
  "CANCELED",
  "CANCELLED",
  "DELETED",
  "BLOCKED",
]);

export function createVercelClient({
  token,
  orgId,
  fetchImpl = globalThis.fetch,
  sdkFactory = (options) => new Vercel(options),
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchが利用できません。");
  }

  const vercel = sdkFactory({
    bearerToken: token,
    httpClient: new HTTPClient({ fetcher: fetchImpl }),
    retryConfig: { strategy: "none" },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  return {
    createDeployment(payload, options = {}) {
      return vercel.deployments.createDeployment({
        requestBody: payload,
        teamId: orgId,
        ...(options?.forceNew === true ? { forceNew: "1" } : {}),
      });
    },
    getDeployment(deploymentId) {
      return vercel.deployments.getDeployment({
        idOrUrl: deploymentId,
        withGitRepoInfo: "true",
        teamId: orgId,
      });
    },
    getProject(projectId) {
      return vercel.projects.getProject({ idOrName: projectId, teamId: orgId });
    },
    listDeploymentAliases(deploymentId) {
      return vercel.aliases.listDeploymentAliases({
        id: deploymentId,
        teamId: orgId,
      });
    },
  };
}

export function deploymentProjectId(deployment, subject) {
  const hasNestedId = deployment?.project !== undefined;
  const nestedId = hasNestedId ? deployment.project?.id : undefined;
  const legacyId = deployment?.projectId;

  for (const id of [nestedId, legacyId]) {
    if (id !== undefined && (typeof id !== "string" || id.trim() === "")) {
      throw new Error(`${subject}のproject idが不正です。`);
    }
  }
  if (hasNestedId && nestedId === undefined) {
    throw new Error(`${subject}のproject idが不正です。`);
  }
  if (
    nestedId !== undefined &&
    legacyId !== undefined &&
    nestedId !== legacyId
  ) {
    throw new Error(`${subject}のproject idが一致しません。`);
  }

  return nestedId ?? legacyId;
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

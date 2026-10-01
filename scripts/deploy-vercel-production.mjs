import { execFileSync as defaultExecFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVercelClient,
  waitForReadyDeployment,
} from "./deploy-vercel-preview.mjs";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const REQUIRED_ENVIRONMENT = [
  "GITHUB_SHA",
  "GITHUB_REF_NAME",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
];

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

  const githubSha = requiredValue(environment, "GITHUB_SHA");
  if (!/^[0-9a-f]{40}$/iu.test(githubSha)) {
    throw new Error("GITHUB_SHAは40桁のhexadecimal SHAである必要があります。");
  }

  const githubRefName = requiredValue(environment, "GITHUB_REF_NAME");
  if (githubRefName !== "main") {
    throw new Error("GITHUB_REF_NAMEはmainである必要があります。");
  }

  const githubRepository = requiredValue(environment, "GITHUB_REPOSITORY");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(githubRepository)) {
    throw new Error(
      "GITHUB_REPOSITORYはowner/repository形式である必要があります。",
    );
  }

  return {
    githubSha,
    githubRefName,
    githubRepository,
    githubRepositoryId: requiredValue(environment, "GITHUB_REPOSITORY_ID"),
    vercelToken: requiredValue(environment, "VERCEL_TOKEN"),
    vercelOrgId: requiredValue(environment, "VERCEL_ORG_ID"),
    vercelProjectId: requiredValue(environment, "VERCEL_PROJECT_ID"),
  };
}

function runGitCommand(execFileSync, args) {
  try {
    return String(
      execFileSync("git", args, {
        encoding: "utf8",
      }),
    );
  } catch (error) {
    throw new Error(`checkout検証のgit ${args.join(" ")}に失敗しました。`, {
      cause: error,
    });
  }
}

export function validateCheckout({
  githubSha,
  execFileSync = defaultExecFileSync,
}) {
  if (typeof execFileSync !== "function") {
    throw new Error("git command executionが利用できません。");
  }

  const head = runGitCommand(execFileSync, ["rev-parse", "HEAD"]).trim();
  if (head !== githubSha) {
    throw new Error("checkoutのHEADがGITHUB_SHAと一致しません。");
  }

  const status = runGitCommand(execFileSync, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.trim() !== "") {
    throw new Error("checkoutのworking treeがcleanではありません。");
  }
}

function repositoryParts(repository) {
  const separator = repository.indexOf("/");
  return {
    org: repository.slice(0, separator),
    repo: repository.slice(separator + 1),
  };
}

function repositoryIdentityMatches(source, config, subject) {
  const { org, repo } = repositoryParts(config.githubRepository);
  const hasOrgOrRepo = source?.org !== undefined || source?.repo !== undefined;
  const hasRepoId = source?.repoId !== undefined && source?.repoId !== null;
  if (!hasOrgOrRepo && !hasRepoId) {
    throw new Error(`${subject}のGitHub repository identityがありません。`);
  }

  const orgAndRepoMatch =
    !hasOrgOrRepo || (source.org === org && source.repo === repo);
  const repoIdMatches =
    !hasRepoId ||
    ((typeof source.repoId === "string" || typeof source.repoId === "number") &&
      String(source.repoId) === config.githubRepositoryId);
  if (!orgAndRepoMatch || !repoIdMatches) {
    throw new Error(
      `${subject}のGitHub repository identityが想定と一致しません。`,
    );
  }
}

function projectGitLink(project) {
  if (project?.link !== undefined && project?.link !== null) {
    return project.link;
  }
  return project?.gitRepository;
}

export function validateProject(project, config) {
  if (
    typeof project?.id !== "string" ||
    project.id.trim() === "" ||
    typeof project?.name !== "string" ||
    project.name.trim() === ""
  ) {
    throw new Error("Vercel project metadataに有効なid/nameがありません。");
  }
  if (project.id !== config.vercelProjectId) {
    throw new Error("Vercel project metadataのidが想定と一致しません。");
  }

  const gitLink = projectGitLink(project);
  if (gitLink?.type !== "github") {
    throw new Error("Vercel projectのGit linkがGitHubではありません。");
  }
  repositoryIdentityMatches(gitLink, config, "Vercel project");

  return {
    id: project.id,
    name: project.name,
  };
}

export function buildProductionDeploymentPayload({
  githubSha,
  githubRepository,
  vercelProjectId,
  projectName,
}) {
  const { org, repo } = repositoryParts(githubRepository);
  return {
    target: "production",
    project: vercelProjectId,
    name: projectName,
    gitSource: {
      type: "github",
      org,
      repo,
      ref: "main",
      sha: githubSha,
    },
  };
}

export function validateReadyDeployment(deployment, config, project) {
  if (deployment?.readyState !== "READY") {
    throw new Error("READYではないProduction deploymentを成功扱いできません。");
  }
  if (deployment.target !== "production") {
    throw new Error("Production deploymentのtargetが想定と一致しません。");
  }
  if (deployment.name !== project.name) {
    throw new Error(
      "Production deploymentのproject nameが想定と一致しません。",
    );
  }
  if (
    deployment.projectId !== undefined &&
    deployment.projectId !== null &&
    String(deployment.projectId) !== config.vercelProjectId
  ) {
    throw new Error("Production deploymentのproject idが想定と一致しません。");
  }

  const gitSource = deployment.gitSource;
  if (gitSource?.type !== "github") {
    throw new Error(
      "Production deploymentのGitHub sourceが想定と一致しません。",
    );
  }
  if (gitSource.sha !== config.githubSha) {
    throw new Error(
      "Production deploymentのsource SHAがGITHUB_SHAと一致しません。",
    );
  }
  if (gitSource.ref !== "main") {
    throw new Error("Production deploymentのsource refがmainと一致しません。");
  }
  repositoryIdentityMatches(gitSource, config, "Production deployment");

  return {
    deploymentId: deployment.id,
    url: deployment.url,
    sha: gitSource.sha,
    ref: gitSource.ref,
  };
}

export async function deployProduction({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  execFileSync = defaultExecFileSync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  sleep: sleepImpl,
  now = Date.now,
} = {}) {
  const config = validateEnvironment(environment);
  validateCheckout({ githubSha: config.githubSha, execFileSync });

  const client = createVercelClient({
    token: config.vercelToken,
    orgId: config.vercelOrgId,
    fetchImpl,
  });
  const projectMetadata = await client.getProject(config.vercelProjectId);
  const project = validateProject(projectMetadata, config);
  const created = await client.createDeployment(
    buildProductionDeploymentPayload({ ...config, projectName: project.name }),
    { forceNew: true },
  );
  if (typeof created?.id !== "string" || created.id === "") {
    throw new Error("Vercel APIのdeployment IDがありません。");
  }

  await waitForReadyDeployment({
    deploymentId: created.id,
    getDeployment: client.getDeployment,
    timeoutMs,
    pollIntervalMs,
    ...(sleepImpl ? { sleep: sleepImpl } : {}),
    now,
  });
  const metadata = await client.getDeployment(created.id);
  return validateReadyDeployment(metadata, config, project);
}

export async function main() {
  const result = await deployProduction();
  console.log(
    `Vercel Production deployment READY: ${result.url} (ref: ${result.ref}, sha: ${result.sha})`,
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
        : "Vercel Production deploymentに失敗しました。",
    );
    process.exitCode = 1;
  }
}

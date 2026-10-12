import assert from "node:assert/strict";
import test from "node:test";
import { main as deployHelpProduction } from "./deploy-help-production.mjs";
import {
  buildProductionDeploymentPayload,
  validateEnvironment,
  validateProject,
  validateReadyDeployment,
} from "./deploy-vercel-production.mjs";

const githubSha = "0123456789abcdef0123456789abcdef01234567";
const environment = {
  GITHUB_SHA: githubSha,
  GITHUB_REF_NAME: "main",
  GITHUB_REPOSITORY: "new-owner/new-name",
  GITHUB_REPOSITORY_ID: "123456789",
  VERCEL_TOKEN: "test-token",
  VERCEL_ORG_ID: "team-test",
  VERCEL_HELP_PROJECT_ID: "help-project",
};

test("Help Production requires the distinct Help project variable", async () => {
  await assert.rejects(
    () => deployHelpProduction({}),
    /VERCEL_HELP_PROJECT_ID/u,
  );
});

test("Help Production identity accepts renamed repositories only with matching repoId", () => {
  const config = validateEnvironment({
    ...environment,
    VERCEL_PROJECT_ID: environment.VERCEL_HELP_PROJECT_ID,
    VERCEL_DEPLOYMENT_KIND: "help",
  });
  const project = {
    id: config.vercelProjectId,
    name: "example-help",
    link: {
      type: "github",
      org: "example-owner",
      repo: "old-repo",
      repoId: 123456789,
    },
  };
  const deployment = {
    id: "dpl_help",
    url: "example-help.vercel.app",
    name: project.name,
    projectId: project.id,
    readyState: "READY",
    target: "production",
    gitSource: {
      type: "github",
      org: "example-owner",
      repo: "old-repo",
      repoId: "123456789",
      ref: "main",
      sha: githubSha,
    },
  };

  assert.doesNotThrow(() => validateProject(project, config));
  assert.doesNotThrow(() =>
    validateReadyDeployment(deployment, config, project),
  );
  assert.deepEqual(
    buildProductionDeploymentPayload({ ...config, projectName: project.name }),
    {
      target: "production",
      project: "help-project",
      name: project.name,
      gitSource: {
        type: "github",
        org: "new-owner",
        repo: "new-name",
        ref: "main",
        sha: githubSha,
      },
    },
  );

  for (const repoId of [undefined, "987654321"]) {
    assert.throws(
      () =>
        validateProject(
          { ...project, link: { ...project.link, repoId } },
          config,
        ),
      /identity/u,
    );
    assert.throws(
      () =>
        validateReadyDeployment(
          {
            ...deployment,
            gitSource: { ...deployment.gitSource, repoId },
          },
          config,
          project,
        ),
      /identity/u,
    );
  }
});

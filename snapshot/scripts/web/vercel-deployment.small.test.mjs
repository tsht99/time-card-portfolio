import assert from "node:assert/strict";
import test from "node:test";
import {
  createVercelClient,
  waitForReadyDeployment,
} from "./vercel-deployment.mjs";

test("createVercelClient maps all operations and configures request policy", async () => {
  const calls = [];
  let sdkOptions;
  const resultValues = {
    createDeployment: { id: "dpl_test" },
    getDeployment: { id: "dpl_test", readyState: "READY" },
    getProject: { id: "prj_test", name: "project-test" },
    listDeploymentAliases: [{ alias: "preview.example.com" }],
  };
  const client = createVercelClient({
    token: "test-token",
    orgId: "team with space",
    fetchImpl: async () => {
      throw new Error("The injected SDK fake should not make HTTP requests.");
    },
    sdkFactory: (options) => {
      sdkOptions = options;
      return {
        deployments: {
          createDeployment: async (request) => {
            calls.push(["createDeployment", request]);
            return resultValues.createDeployment;
          },
          getDeployment: async (request) => {
            calls.push(["getDeployment", request]);
            return resultValues.getDeployment;
          },
        },
        projects: {
          getProject: async (request) => {
            calls.push(["getProject", request]);
            return resultValues.getProject;
          },
        },
        aliases: {
          listDeploymentAliases: async (request) => {
            calls.push(["listDeploymentAliases", request]);
            return resultValues.listDeploymentAliases;
          },
        },
      };
    },
  });

  assert.deepEqual(
    await client.createDeployment(
      { name: "project-test", project: "project-test" },
      { forceNew: true },
    ),
    resultValues.createDeployment,
  );
  assert.deepEqual(
    await client.getDeployment("dpl_test"),
    resultValues.getDeployment,
  );
  assert.deepEqual(
    await client.getProject("prj_test"),
    resultValues.getProject,
  );
  assert.deepEqual(
    await client.listDeploymentAliases("dpl_test"),
    resultValues.listDeploymentAliases,
  );

  assert.equal(sdkOptions.bearerToken, "test-token");
  assert.equal(sdkOptions.timeoutMs, 30_000);
  assert.deepEqual(sdkOptions.retryConfig, { strategy: "none" });
  assert.deepEqual(calls, [
    [
      "createDeployment",
      {
        requestBody: { name: "project-test", project: "project-test" },
        teamId: "team with space",
        forceNew: "1",
      },
    ],
    [
      "getDeployment",
      {
        idOrUrl: "dpl_test",
        withGitRepoInfo: "true",
        teamId: "team with space",
      },
    ],
    ["getProject", { idOrName: "prj_test", teamId: "team with space" }],
    ["listDeploymentAliases", { id: "dpl_test", teamId: "team with space" }],
  ]);
});

test("waitForReadyDeployment returns READY deployment after polling", async () => {
  const responses = [
    { readyState: "BUILDING" },
    { readyState: "READY", id: "dpl_test" },
  ];
  const sleeps = [];
  const result = await waitForReadyDeployment({
    deploymentId: "dpl_test",
    getDeployment: async () => responses.shift(),
    pollIntervalMs: 250,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });

  assert.deepEqual(result, { readyState: "READY", id: "dpl_test" });
  assert.deepEqual(sleeps, [250]);
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

test("waitForReadyDeployment bounds polling by the injectable timeout and clock", async () => {
  let currentTime = 0;
  const sleeps = [];
  await assert.rejects(
    waitForReadyDeployment({
      deploymentId: "dpl_test",
      getDeployment: async () => ({ readyState: "BUILDING" }),
      timeoutMs: 12,
      pollIntervalMs: 10,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        currentTime += milliseconds;
      },
    }),
    /タイムアウト/u,
  );
  assert.deepEqual(sleeps, [10, 2]);
  assert.equal(currentTime, 12);
});

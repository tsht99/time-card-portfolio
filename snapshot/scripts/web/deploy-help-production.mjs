import { deployProduction } from "./deploy-vercel-production.mjs";

export async function main(environment = process.env) {
  const projectId = environment.VERCEL_HELP_PROJECT_ID;
  if (typeof projectId !== "string" || projectId.trim() === "") {
    throw new Error("必要な環境変数がありません: VERCEL_HELP_PROJECT_ID");
  }
  return deployProduction({
    environment: {
      ...environment,
      VERCEL_PROJECT_ID: projectId,
      VERCEL_DEPLOYMENT_KIND: "help",
    },
  });
}

if (process.argv[1]?.endsWith("deploy-help-production.mjs")) {
  try {
    const result = await main();
    console.log(
      `Help Production deployment READY: ${result.url} (ref: ${result.ref}, sha: ${result.sha})`,
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Help Production deploymentに失敗しました。",
    );
    process.exitCode = 1;
  }
}

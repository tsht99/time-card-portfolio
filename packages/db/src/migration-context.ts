export type MigrationMode = "local" | "deploy";
export type MigrationContext = {
  mode: MigrationMode;
  environment: "local" | "preview" | "production";
  isVercel: boolean;
};

export function validateMigrationContext(
  mode: MigrationMode,
  env: NodeJS.ProcessEnv = process.env,
): MigrationContext {
  const vercel = env.VERCEL;
  const vercelEnv = env.VERCEL_ENV;
  const branch = env.VERCEL_GIT_COMMIT_REF;
  const dbEnv = env.DATABASE_ENVIRONMENT;
  const hasVercelSignal =
    vercel !== undefined || vercelEnv !== undefined || branch !== undefined;

  if (!hasVercelSignal) {
    if (dbEnv !== "local")
      throw new Error("DATABASE_ENVIRONMENT must be local outside Vercel.");
    if (mode !== "local")
      throw new Error("Deployment migrations require Vercel.");
    return { mode, environment: "local", isVercel: false };
  }

  if (vercel !== "1" && vercel !== "true")
    throw new Error("Invalid Vercel environment marker.");
  if (vercelEnv === "preview" && branch === "develop" && dbEnv === "preview") {
    if (mode !== "deploy")
      throw new Error("Local migration runner cannot run on Vercel.");
    return { mode, environment: "preview", isVercel: true };
  }
  if (
    vercelEnv === "production" &&
    branch === "main" &&
    dbEnv === "production"
  ) {
    if (mode !== "deploy")
      throw new Error("Local migration runner cannot run on Vercel.");
    return { mode, environment: "production", isVercel: true };
  }
  throw new Error(
    "Vercel and database environment do not match a supported migration context.",
  );
}

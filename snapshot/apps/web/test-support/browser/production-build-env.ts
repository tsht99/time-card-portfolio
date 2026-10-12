export function getProductionBuildEnv<
  TEnvironment extends Record<string, string | undefined>,
>(
  environment: TEnvironment,
  webTestEnv: Record<string, string | undefined>,
): TEnvironment & Record<string, string | undefined> {
  return { ...environment, ...webTestEnv };
}

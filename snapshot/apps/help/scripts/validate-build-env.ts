import { fileURLToPath } from "node:url";
import { resolveHelpMediaUrl } from "../lib/help-media.ts";

const mediaBaseVariables = [
  {
    name: "HELP_SCREENSHOT_BASE",
    namespace: "screenshots",
    sampleName: "build-validation.png",
  },
  {
    name: "HELP_VIDEO_BASE",
    namespace: "videos",
    sampleName: "build-validation.mp4",
  },
] as const;

export function validateHelpBuildEnvironment(
  environment: Record<string, string | undefined>,
): string[] {
  const errors: string[] = [];

  for (const { name, namespace, sampleName } of mediaBaseVariables) {
    const value = environment[name];
    if (!value?.trim()) {
      errors.push(`${name} is required for Help build`);
    } else if (resolveHelpMediaUrl(namespace, sampleName, value) === null) {
      errors.push(`${name} is invalid for Help build`);
    }
  }

  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateHelpBuildEnvironment(process.env);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}

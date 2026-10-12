import type { TutorialScenario } from "./scenario";

export const resolveTtsText = (segment: {
  narration: string;
  ttsTextOverride?: string;
}) => segment.ttsTextOverride ?? segment.narration;

export const createAudioGenerationArguments = (options: {
  text: string;
  outputPath: string;
  pythonProject: string;
  scriptPath: string;
  modelDirectory: string;
  seed: number;
}) => [
  "run",
  "--project",
  options.pythonProject,
  "--frozen",
  "python",
  options.scriptPath,
  "--text",
  options.text,
  "--output",
  options.outputPath,
  "--model-dir",
  options.modelDirectory,
  "--seed",
  String(options.seed),
];

export const toSourceSegments = (segments: TutorialScenario["segments"]) =>
  segments.map(({ id, narration, ttsTextOverride }) => ({
    id,
    narration,
    ttsText: resolveTtsText({ narration, ttsTextOverride }),
  }));

export const isTutorialScenario = (
  value: unknown,
): value is TutorialScenario => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TutorialScenario>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.audioDirectory === "string" &&
    Array.isArray(candidate.segments) &&
    candidate.segments.every(
      (segment) =>
        typeof segment.id === "string" &&
        typeof segment.narration === "string" &&
        segment.narration.trim().length > 0 &&
        (segment.ttsTextOverride === undefined ||
          (typeof segment.ttsTextOverride === "string" &&
            segment.ttsTextOverride.trim().length > 0)),
    )
  );
};

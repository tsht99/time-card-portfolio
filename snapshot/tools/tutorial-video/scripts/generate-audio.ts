import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createAudioGenerationArguments,
  isTutorialScenario,
  resolveTtsText,
  toSourceSegments,
} from "../src/speech-text";

async function main() {
  const scenarioName =
    process.argv.slice(2).find((argument) => argument !== "--") ?? "clock-in";
  const scenarioModule = await import(`../src/scenarios/${scenarioName}.ts`);
  const scenarioExportName = scenarioName.replace(
    /-([a-z])/g,
    (_, letter: string) => letter.toUpperCase(),
  );
  const scenarioCandidate: unknown =
    scenarioModule[`${scenarioExportName}Scenario`];
  if (!isTutorialScenario(scenarioCandidate)) {
    throw new Error(
      `Scenario module ${scenarioName} must export ${scenarioExportName}Scenario`,
    );
  }
  const scenario = scenarioCandidate;

  const outputDirectory = resolve("public", scenario.audioDirectory);
  await mkdir(outputDirectory, { recursive: true });

  for (const segment of scenario.segments) {
    const outputPath = resolve(outputDirectory, `${segment.id}.wav`);
    const seed = createHash("sha256")
      .update(`${scenario.id}\0${segment.id}`)
      .digest()
      .readUInt32BE(0);
    const result = spawnSync(
      "uv",
      createAudioGenerationArguments({
        text: resolveTtsText(segment),
        outputPath,
        pythonProject: resolve("python"),
        scriptPath: resolve("python/generate_audio.py"),
        modelDirectory: resolve("public/models/supertonic-3"),
        seed,
      }),
      { stdio: "inherit" },
    );

    if (result.status !== 0) {
      throw new Error(`TTS generation failed for ${segment.id}`);
    }
  }

  await writeFile(
    resolve(outputDirectory, "source.json"),
    JSON.stringify(
      {
        scenarioId: scenario.id,
        segments: toSourceSegments(scenario.segments),
      },
      null,
      2,
    ),
  );
}

await main();

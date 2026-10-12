import assert from "node:assert/strict";
import test from "node:test";
import { clockInScenario } from "./scenarios/clock-in";
import { clockOutScenario } from "./scenarios/clock-out";
import {
  createAudioGenerationArguments,
  isTutorialScenario,
  resolveTtsText,
  toSourceSegments,
} from "./speech-text";

test("TTS uses narration by default and an explicit non-empty override when set", () => {
  assert.equal(resolveTtsText({ narration: "字幕" }), "字幕");
  assert.equal(
    resolveTtsText({ narration: "昼勤務中", ttsTextOverride: "ひる勤務中" }),
    "ひる勤務中",
  );
  assert.equal(
    isTutorialScenario({
      id: "x",
      audioDirectory: "x",
      segments: [
        {
          id: "s",
          narration: "字幕",
          ttsTextOverride: "漢字を含む読み",
          startFrame: 0,
          durationInFrames: 1,
        },
      ],
    }),
    true,
  );
  assert.equal(
    isTutorialScenario({
      id: "x",
      audioDirectory: "x",
      segments: [
        {
          id: "s",
          narration: "字幕",
          ttsTextOverride: "  ",
          startFrame: 0,
          durationInFrames: 1,
        },
      ],
    }),
    false,
  );
});

test("clock-in and clock-out correct only the confirmed reading in TTS", () => {
  const clockInComplete = clockInScenario.segments[3];
  const clockOutWorking = clockOutScenario.segments[0];
  assert.ok(clockInComplete);
  assert.ok(clockOutWorking);
  assert.equal(isTutorialScenario(clockInScenario), true);
  assert.equal(
    clockInScenario.segments[3]?.narration,
    "「昼勤務中」と表示されたら、出勤の記録は完了です。",
  );
  assert.equal(
    resolveTtsText(clockInComplete),
    "「ひる勤務中」と表示されたら、出勤の記録は完了です。",
  );
  assert.equal(
    clockOutScenario.segments[0]?.narration,
    "現在は「昼勤務中」です。退勤時刻を記録します。",
  );
  assert.equal(
    resolveTtsText(clockOutWorking),
    "現在は「ひる勤務中」です。退勤時刻を記録します。",
  );
  assert.deepEqual(
    [...clockInScenario.segments, ...clockOutScenario.segments]
      .filter(({ ttsTextOverride }) => ttsTextOverride !== undefined)
      .map(({ id }) => id),
    ["period", "complete", "working"],
  );
});

test("audio arguments and source metadata contain the resolved TTS input", () => {
  const segment = clockInScenario.segments.find(({ id }) => id === "complete");
  assert.ok(segment);
  const ttsText = resolveTtsText(segment);
  const args = createAudioGenerationArguments({
    text: ttsText,
    outputPath: "complete.wav",
    pythonProject: "python",
    scriptPath: "generate_audio.py",
    modelDirectory: "model",
    seed: 7,
  });
  assert.equal(args[args.indexOf("--text") + 1], ttsText);
  assert.deepEqual(toSourceSegments([segment]), [
    {
      id: "complete",
      narration: "「昼勤務中」と表示されたら、出勤の記録は完了です。",
      ttsText: "「ひる勤務中」と表示されたら、出勤の記録は完了です。",
    },
  ]);
});

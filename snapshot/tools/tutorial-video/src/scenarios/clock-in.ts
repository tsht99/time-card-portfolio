import type { TutorialScenario } from "../scenario";

export const clockInScenario = {
  id: "tutorial-clock-in",
  title: "スタッフの出勤",
  durationInFrames: 30 * 19.2,
  recording: "recordings/clock-in.webm",
  audioDirectory: "audio/clock-in",
  segments: [
    {
      id: "period",
      narration: "今回は昼勤務として出勤します。",
      // Supertonic 3 が「昼勤務」の「昼」を「ちゅう」と誤読するため、読みを補正する。
      ttsTextOverride: "今回はひる勤務として出勤します。",
      startFrame: 0,
      durationInFrames: 120,
    },
    {
      id: "time",
      narration: "出勤時刻を確認し、実際の時刻を入力します。",
      startFrame: 120,
      durationInFrames: 180,
    },
    {
      id: "clock-in",
      narration: "「昼に出勤」を押します。",
      startFrame: 300,
      durationInFrames: 90,
    },
    {
      id: "complete",
      narration: "「昼勤務中」と表示されたら、出勤の記録は完了です。",
      // Supertonic 3 が「昼勤務中」の「昼」を「ちゅう」と誤読するため、読みを補正する。
      ttsTextOverride: "「ひる勤務中」と表示されたら、出勤の記録は完了です。",
      startFrame: 390,
      durationInFrames: 186,
    },
  ],
} satisfies TutorialScenario;

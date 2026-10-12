import type { TutorialScenario } from "../scenario";

export const clockOutScenario = {
  id: "tutorial-clock-out",
  title: "スタッフの退勤",
  durationInFrames: 30 * 19.8,
  recording: "recordings/clock-out.webm",
  audioDirectory: "audio/clock-out",
  segments: [
    {
      id: "working",
      narration: "現在は「昼勤務中」です。退勤時刻を記録します。",
      // Supertonic 3 が「昼勤務中」の「昼」を「ちゅう」と誤読するため、読みを補正する。
      ttsTextOverride: "現在は「ひる勤務中」です。退勤時刻を記録します。",
      startFrame: 0,
      durationInFrames: 180,
    },
    {
      id: "time",
      narration: "打刻時刻に、実際の退勤時刻を入力します。",
      startFrame: 180,
      durationInFrames: 165,
    },
    {
      id: "clock-out",
      narration: "「退勤」を押します。",
      startFrame: 345,
      durationInFrames: 78,
    },
    {
      id: "complete",
      narration: "「未勤務」と表示されたら、退勤の記録は完了です。",
      startFrame: 423,
      durationInFrames: 171,
    },
  ],
} satisfies TutorialScenario;

import type { TutorialScenario } from "../scenario";

export const attendanceCorrectionScenario = {
  id: "tutorial-attendance-correction",
  title: "管理者の勤怠訂正",
  durationInFrames: 37 * 30 + 12,
  recording: "recordings/attendance-correction.webm",
  recordingStartFrame: 105,
  audioDirectory: "audio/attendance-correction",
  segments: [
    {
      id: "current-attendance",
      narration: "訂正する勤怠の対象者と、現在の出退勤時刻を確認します。",
      // 字幕の「出退勤」表記を保ち、音声では「しゅったいきん」と読ませる。
      ttsTextOverride:
        "訂正する勤怠の対象者と、現在のしゅったいきん時刻を確認します。",
      startFrame: 0,
      durationInFrames: 231,
      captionPosition: "top",
      compactCaption: true,
    },
    {
      id: "open-correction",
      narration: "「訂正」を開きます。",
      startFrame: 231,
      durationInFrames: 96,
    },
    {
      id: "edit-clock-out",
      narration:
        "確認できた正しい内容を入力します。今回は退勤時刻を18時に訂正します。",
      startFrame: 327,
      durationInFrames: 360,
      captionPosition: "top",
      compactCaption: true,
    },
    {
      id: "save-correction",
      narration: "入力内容を確認して「保存」を押します。",
      startFrame: 687,
      durationInFrames: 165,
      captionPosition: "top",
      compactCaption: true,
    },
    {
      id: "confirm-correction",
      narration:
        "勤怠詳細に戻り、退勤時刻が18時に変わっていれば訂正は完了です。",
      startFrame: 852,
      durationInFrames: 270,
      captionPosition: "top",
      compactCaption: true,
    },
  ],
} satisfies TutorialScenario;

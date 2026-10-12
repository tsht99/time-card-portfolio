import type { TutorialScenario } from "../scenario";

export const hourlyWageRuleBulkEditScenario = {
  id: "tutorial-hourly-wage-rule-bulk-edit",
  title: "管理者の時給一括改定",
  durationInFrames: 1500,
  recording: "recordings/hourly-wage-rule-bulk-edit.webm",
  recordingStartFrame: 60,
  audioDirectory: "audio/hourly-wage-rule-bulk-edit",
  segments: [
    {
      id: "current-wages",
      narration: "時給設定で、現在の時給を確認してから編集を開きます。",
      startFrame: 0,
      durationInFrames: 240,
      captionPosition: "top",
      compactCaption: true,
    },
    {
      id: "effective-date",
      narration: "共通の適用開始日を指定します。今回は2月1日から変更します。",
      // 字幕の表記は保ち、音声では「適用、かいしび」と読ませる。
      ttsTextOverride:
        "共通の適用、かいしびを指定します。今回は2月ついたちから変更します。",
      startFrame: 240,
      durationInFrames: 255,
      captionPosition: "top",
      compactCaption: true,
    },
    {
      id: "wage-changes",
      narration:
        "変更する欄だけに新しい時給を入力します。今回は月曜の昼を1,300円、火曜の夜を1,500円に変更します。",
      // 音声では金額の桁区切りコンマを読まず、数字を続けて読ませる。
      ttsTextOverride:
        "変更する欄だけに新しい時給を入力します。今回は月曜の昼を1300円、火曜の夜を1500円に変更します。",
      startFrame: 495,
      durationInFrames: 450,
      captionPosition: "top",
      compactCaption: true,
    },
    {
      id: "save-changes",
      narration: "入力内容を確認して「保存」を押します。",
      startFrame: 945,
      durationInFrames: 150,
      captionPosition: "top",
      compactCaption: true,
    },
    {
      id: "confirm-changes",
      narration:
        "「時給を更新しました」と表示され、2月1日時点の時給に反映されれば完了です。",
      // 音声では「2月1日」を「2月ついたち」と読ませる。
      ttsTextOverride:
        "「時給を更新しました」と表示され、2月ついたち時点の時給に反映されれば完了です。",
      startFrame: 1095,
      durationInFrames: 405,
      captionPosition: "top",
      compactCaption: true,
    },
  ],
} satisfies TutorialScenario;

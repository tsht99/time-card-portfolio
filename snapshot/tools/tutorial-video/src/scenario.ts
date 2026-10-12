export type TutorialScenario = {
  id: string;
  title: string;
  durationInFrames: number;
  recording: string;
  recordingStartFrame?: number;
  audioDirectory: string;
  segments: Array<{
    id: string;
    narration: string;
    ttsTextOverride?: string;
    startFrame: number;
    durationInFrames: number;
    captionPosition?: "top";
    compactCaption?: boolean;
  }>;
};

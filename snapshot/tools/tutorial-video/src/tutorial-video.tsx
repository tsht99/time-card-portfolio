import { Html5Audio, OffthreadVideo, Sequence, staticFile } from "remotion";
import type { TutorialScenario } from "./scenario";

export const TutorialVideo = ({ scenario }: { scenario: TutorialScenario }) => (
  <>
    <OffthreadVideo
      src={staticFile(scenario.recording)}
      muted
      trimBefore={scenario.recordingStartFrame ?? 0}
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
    {scenario.segments.map((segment) => (
      <Sequence
        key={segment.id}
        from={segment.startFrame}
        durationInFrames={segment.durationInFrames}
      >
        <Html5Audio
          src={staticFile(`${scenario.audioDirectory}/${segment.id}.wav`)}
        />
        <div
          style={{
            position: "absolute",
            left: 34,
            right: 34,
            ...(segment.captionPosition === "top"
              ? { top: 20 }
              : { bottom: 54 }),
            padding: segment.compactCaption ? "12px 14px" : "20px 22px",
            borderRadius: 12,
            backgroundColor: "rgba(0, 0, 0, 0.82)",
            color: "white",
            fontFamily: "sans-serif",
            fontSize: segment.compactCaption ? 26 : 34,
            fontWeight: 700,
            lineHeight: segment.compactCaption ? 1.35 : 1.45,
            textAlign: "center",
            textShadow: "0 2px 3px rgba(0,0,0,.9)",
          }}
        >
          {segment.narration}
        </div>
      </Sequence>
    ))}
  </>
);

import { createElement, type ReactElement } from "react";
import { resolveHelpMediaUrl } from "../../../lib/help-media.ts";

type TutorialVideoProps = {
  name: string;
  label: string;
};

export function TutorialVideo({
  name,
  label,
}: TutorialVideoProps): ReactElement | null {
  if (!label.trim())
    throw new Error("TutorialVideo requires an accessible label.");

  const src = resolveHelpMediaUrl("videos", name, process.env.HELP_VIDEO_BASE);
  if (!src) return null;

  return createElement("video", {
    src,
    controls: true,
    preload: "none",
    playsInline: true,
    "aria-label": label,
    style: {
      display: "block",
      width: "100%",
      maxWidth: "320px",
      aspectRatio: "540 / 1170",
      height: "auto",
      marginBlock: "1.5rem",
      marginInline: "auto",
    },
  });
}

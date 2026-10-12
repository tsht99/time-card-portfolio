import { createElement, type ReactElement } from "react";
import { resolveHelpMediaUrl } from "../../../lib/help-media.ts";

type ScreenshotProps = {
  name: string;
  alt: string;
};

export function Screenshot({
  name,
  alt,
}: ScreenshotProps): ReactElement | null {
  if (!alt.trim()) throw new Error("Screenshot requires descriptive alt text.");

  const src = resolveHelpMediaUrl(
    "screenshots",
    name,
    process.env.HELP_SCREENSHOT_BASE,
  );
  if (!src) return null;

  return createElement("img", {
    src,
    alt,
    loading: "lazy",
    style: {
      display: "block",
      width: "100%",
      maxWidth: "100%",
      height: "auto",
      marginBlock: "1.5rem",
    },
  });
}

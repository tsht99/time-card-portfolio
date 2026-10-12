import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TutorialVideo } from "./tutorial-video.ts";

function renderTutorialVideo(name: string, base?: string) {
  const original = process.env.HELP_VIDEO_BASE;
  if (base === undefined) delete process.env.HELP_VIDEO_BASE;
  else process.env.HELP_VIDEO_BASE = base;

  try {
    const markup = renderToStaticMarkup(
      createElement(TutorialVideo, {
        name,
        label: "スタッフが出勤する操作説明動画",
      }),
    );
    return {
      markup,
      src: markup.match(/\bsrc="([^"]+)"/)?.[1] ?? null,
    };
  } finally {
    if (original === undefined) delete process.env.HELP_VIDEO_BASE;
    else process.env.HELP_VIDEO_BASE = original;
  }
}

test("tutorial video uses its absolute base with or without a trailing slash", () => {
  for (const base of [
    "https://storage.example/videos",
    "https://storage.example/videos/",
  ]) {
    assert.equal(
      renderTutorialVideo("clock-in.mp4", base).src,
      "https://storage.example/videos/clock-in.mp4",
    );
  }
});

test("tutorial video resolver does not add namespaces and rejects unsafe names", () => {
  for (const name of [
    "../clock-in.mp4",
    "/clock-in.mp4",
    "https://example.test/clock-in.mp4",
    "clock in.mp4",
    "clock-in.mov",
  ]) {
    assert.equal(
      renderTutorialVideo(name, "https://storage.example/videos").src,
      null,
      `${name} should be rejected`,
    );
  }
});

test("tutorial video is omitted without the optional media environment setting", () => {
  assert.equal(renderTutorialVideo("clock-in.mp4").markup, "");
});

test("tutorial video has native accessible controls and compact responsive sizing", () => {
  const { markup } = renderTutorialVideo(
    "clock-in.mp4",
    "https://storage.example/videos",
  );
  assert.match(markup, /<video\b/);
  assert.match(markup, /controls=""/);
  assert.match(markup, /preload="none"/);
  assert.match(markup, /playsInline=""/i);
  assert.match(markup, /aria-label="スタッフが出勤する操作説明動画"/);
  assert.doesNotMatch(markup, /\sautoplay(?:=|\s|>)/);
  assert.match(markup, /width:100%/);
  assert.match(markup, /max-width:320px/);
  assert.match(markup, /aspect-ratio:540 \/ 1170/);
  assert.match(markup, /margin-inline:auto/);
  assert.match(markup, /margin-block:1\.5rem/);
});

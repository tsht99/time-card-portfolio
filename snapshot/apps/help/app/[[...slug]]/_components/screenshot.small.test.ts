import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Screenshot } from "./screenshot.ts";

function renderScreenshot(name: string, base?: string) {
  const original = process.env.HELP_SCREENSHOT_BASE;
  if (base === undefined) delete process.env.HELP_SCREENSHOT_BASE;
  else process.env.HELP_SCREENSHOT_BASE = base;

  try {
    const markup = renderToStaticMarkup(
      createElement(Screenshot, {
        name,
        alt: "出勤時刻を入力する画面",
      }),
    );
    return {
      markup,
      src: markup.match(/\bsrc="([^"]+)"/)?.[1] ?? null,
    };
  } finally {
    if (original === undefined) delete process.env.HELP_SCREENSHOT_BASE;
    else process.env.HELP_SCREENSHOT_BASE = original;
  }
}

test("screenshot joins origin-relative and absolute bases with or without a trailing slash", () => {
  assert.equal(
    renderScreenshot("staff-clock-in.png", "/images/generated").src,
    "/images/generated/staff-clock-in.png",
  );
  assert.equal(
    renderScreenshot("staff-clock-in.png", "/images/generated/").src,
    "/images/generated/staff-clock-in.png",
  );
  assert.equal(
    renderScreenshot(
      "staff-clock-in.png",
      "https://storage.example/screenshots",
    ).src,
    "https://storage.example/screenshots/staff-clock-in.png",
  );
});

test("screenshot resolver does not add namespaces and rejects unsafe bases or names", () => {
  for (const name of [
    "../secret.png",
    "https://example.test/image.png",
    "/staff-clock-in.png",
    "staff clock in.png",
    "staff-clock-in.jpg",
  ]) {
    assert.equal(
      renderScreenshot(name, "/images/generated").src,
      null,
      `${name} should be rejected`,
    );
  }
  for (const base of [
    "//example.test/images",
    "images/generated",
    "/images/../secret",
    "/images/%2e%2e/secret",
    "/images/%2F../secret",
    "/images?a=1",
    "/images#x",
    "/images/ ",
    "ftp://example.test/images",
    "https://user:pass@example.test/images",
    "https://example.test/images?q=1",
    "https://example.test/images#x",
    "https://example.test/images?",
  ]) {
    assert.equal(
      renderScreenshot("staff-clock-in.png", base).src,
      null,
      `${base} should be rejected`,
    );
  }
});

test("screenshot is omitted without the optional media environment setting", () => {
  assert.equal(renderScreenshot("staff-clock-in.png").markup, "");
});

test("screenshot renders an accessible, responsive, lazy image", () => {
  const { markup } = renderScreenshot(
    "staff-clock-in.png",
    "https://storage.example/time-card-help/screenshots/",
  );
  assert.match(
    markup,
    /src="https:\/\/storage\.example\/time-card-help\/screenshots\/staff-clock-in\.png"/,
  );
  assert.match(markup, /alt="出勤時刻を入力する画面"/);
  assert.match(markup, /loading="lazy"/);
  assert.match(markup, /width:100%/);
  assert.match(markup, /max-width:100%/);
  assert.match(markup, /height:auto/);
  assert.throws(
    () =>
      renderToStaticMarkup(
        createElement(Screenshot, { name: "staff-clock-in.png", alt: "" }),
      ),
    { message: "Screenshot requires descriptive alt text." },
  );
});

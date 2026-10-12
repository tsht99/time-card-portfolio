import assert from "node:assert/strict";
import { test } from "node:test";
import { validateHelpBuildEnvironment } from "./validate-build-env.ts";

const validEnvironment = {
  HELP_SCREENSHOT_BASE: "/images/generated",
  HELP_VIDEO_BASE: "https://media.example.test/videos/",
};

test("Help build environment accepts origin-relative and absolute media bases", () => {
  assert.deepEqual(validateHelpBuildEnvironment(validEnvironment), []);
  assert.deepEqual(
    validateHelpBuildEnvironment({
      HELP_SCREENSHOT_BASE: "https://media.example.test/screenshots",
      HELP_VIDEO_BASE: "/videos",
    }),
    [],
  );
});

test("Help build environment reports each missing media base", () => {
  assert.deepEqual(
    validateHelpBuildEnvironment({
      HELP_VIDEO_BASE: validEnvironment.HELP_VIDEO_BASE,
    }),
    ["HELP_SCREENSHOT_BASE is required for Help build"],
  );
  assert.deepEqual(
    validateHelpBuildEnvironment({
      HELP_SCREENSHOT_BASE: validEnvironment.HELP_SCREENSHOT_BASE,
    }),
    ["HELP_VIDEO_BASE is required for Help build"],
  );
});

test("Help build environment rejects empty and whitespace-only media bases", () => {
  for (const value of ["", "   ", "\n\t"]) {
    assert.deepEqual(
      validateHelpBuildEnvironment({
        HELP_SCREENSHOT_BASE: value,
        HELP_VIDEO_BASE: validEnvironment.HELP_VIDEO_BASE,
      }),
      ["HELP_SCREENSHOT_BASE is required for Help build"],
    );
  }
});

test("Help build environment identifies invalid media bases by variable name", () => {
  for (const value of [
    "//media.example.test/screenshots",
    "images/generated",
    "/images/../private",
    "https://user:pass@media.example.test/videos",
    "ftp://media.example.test/videos",
    "https://media.example.test/videos?download=1",
    "/images\\generated",
    "/images/generated with spaces",
  ]) {
    assert.deepEqual(
      validateHelpBuildEnvironment({
        HELP_SCREENSHOT_BASE: value,
        HELP_VIDEO_BASE: validEnvironment.HELP_VIDEO_BASE,
      }),
      ["HELP_SCREENSHOT_BASE is invalid for Help build"],
    );
  }

  assert.deepEqual(
    validateHelpBuildEnvironment({
      HELP_SCREENSHOT_BASE: validEnvironment.HELP_SCREENSHOT_BASE,
      HELP_VIDEO_BASE: "https://media.example.test/videos#fragment",
    }),
    ["HELP_VIDEO_BASE is invalid for Help build"],
  );
});

test("Help build environment reports multiple invalid settings together", () => {
  assert.deepEqual(validateHelpBuildEnvironment({}), [
    "HELP_SCREENSHOT_BASE is required for Help build",
    "HELP_VIDEO_BASE is required for Help build",
  ]);
});

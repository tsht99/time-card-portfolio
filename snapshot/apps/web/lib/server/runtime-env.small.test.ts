import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLineChannelId,
  getSentryRuntimeConfiguration,
  getSessionTtlHours,
} from "./runtime-env";

afterEach(() => vi.unstubAllEnvs());

describe("Web server runtime environment", () => {
  it.each([undefined, ""])("requires LINE_CHANNEL_ID (%s)", (value) => {
    vi.stubEnv("LINE_CHANNEL_ID", value);
    expect(() => getLineChannelId()).toThrow("LINE_CHANNEL_ID");
  });

  it("returns the configured LINE_CHANNEL_ID", () => {
    vi.stubEnv("LINE_CHANNEL_ID", "channel-id");
    expect(getLineChannelId()).toBe("channel-id");
  });

  it("defaults SESSION_TTL_HOURS to 24", () => {
    vi.stubEnv("SESSION_TTL_HOURS", "");
    expect(getSessionTtlHours()).toBe(24);
  });

  it.each(["0", "-1", "Infinity", "not-a-number"])(
    "rejects invalid SESSION_TTL_HOURS %s",
    (value) => {
      vi.stubEnv("SESSION_TTL_HOURS", value);
      expect(() => getSessionTtlHours()).toThrow("SESSION_TTL_HOURS");
    },
  );

  it("uses VERCEL_GIT_COMMIT_SHA when SENTRY_RELEASE is unset", () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.com/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "preview");
    vi.stubEnv("SENTRY_RELEASE", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "commit-sha");

    expect(getSentryRuntimeConfiguration()).toEqual({
      dsn: "https://public@example.com/1",
      environment: "preview",
      release: "commit-sha",
    });
  });

  it("treats empty Sentry values as unset", () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("SENTRY_RELEASE", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");

    expect(getSentryRuntimeConfiguration()).toBeUndefined();
  });

  it("rejects an invalid Sentry DSN", () => {
    vi.stubEnv("SENTRY_DSN", "not-a-url");
    expect(() => getSentryRuntimeConfiguration()).toThrow("SENTRY_DSN");
  });
});

import { describe, expect, it } from "vitest";
import { env } from "../env";

describe("test environment", () => {
  it("uses the repository-managed test environment", () => {
    expect(env.NEXT_PUBLIC_LIFF_ID).toBe("test-liff-id");

    expect(process.env.SENTRY_DSN).toBe("");
    expect(process.env.SENTRY_ENVIRONMENT).toBe("");
    expect(process.env.SENTRY_RELEASE).toBe("");
    expect(process.env.SENTRY_AUTH_TOKEN).toBe("");
    expect(process.env.SENTRY_ORG).toBe("");
    expect(process.env.SENTRY_PROJECT).toBe("");
    expect(process.env.VERCEL_GIT_COMMIT_SHA).toBe("");
    expect(process.env.NEXT_PUBLIC_SENTRY_DSN).toBe("");
    expect(process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT).toBe("");
    expect(process.env.NEXT_PUBLIC_SENTRY_RELEASE).toBe("");
    expect(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA).toBe("");

    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(env.NEXT_PUBLIC_SENTRY_ENVIRONMENT).toBeUndefined();
    expect(env.NEXT_PUBLIC_SENTRY_RELEASE).toBeUndefined();
  });
});

import type { Event } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { sanitizeSentryEvent } from "./sentry-event-sanitizer";

describe("sanitizeSentryEvent", () => {
  const syntheticSecret = "SYNTHETIC_ACCESS_TOKEN_MARKER";

  it("許可された操作タグとイベント分類以外をすべて除外する", () => {
    const event = {
      event_id: "a".repeat(32),
      timestamp: 123,
      platform: "javascript",
      level: "error",
      environment: "production",
      release: "time-card-1.2.3",
      message: syntheticSecret,
      request: { url: `https://example.test/?token=${syntheticSecret}` },
      user: { id: syntheticSecret },
      breadcrumbs: [{ message: syntheticSecret }],
      contexts: { trace: { data: syntheticSecret } },
      extra: { secret: syntheticSecret },
      tags: {
        "timecard.operation": "staff.attendance.read.current",
        arbitrary: syntheticSecret,
      },
      exception: {
        values: [
          {
            type: "TypeError",
            value: syntheticSecret,
            stacktrace: { frames: [{ filename: syntheticSecret }] },
            cause: {
              type: "Error",
              value: `${syntheticSecret}_CAUSE`,
              stacktrace: { frames: [{ filename: syntheticSecret }] },
            },
          },
        ],
      },
    } as unknown as Event;

    expect(sanitizeSentryEvent(event)).toEqual({
      event_id: "a".repeat(32),
      timestamp: 123,
      platform: "javascript",
      level: "error",
      environment: "production",
      release: "time-card-1.2.3",
      tags: { "timecard.operation": "staff.attendance.read.current" },
      exception: {
        values: [
          { type: "TypeError", value: "Unexpected server operation failure" },
        ],
      },
    });
    expect(JSON.stringify(sanitizeSentryEvent(event))).not.toContain(
      syntheticSecret,
    );
  });

  it("識別子形式でも未知の例外型名を既知の安全な分類へ正規化する", () => {
    const event = {
      exception: {
        values: [
          { type: syntheticSecret, value: "untrusted" },
          { type: "TypeError", value: "untrusted" },
        ],
      },
    } as unknown as Event;

    const sanitized = sanitizeSentryEvent(event);

    expect(sanitized.exception?.values?.map(({ type }) => type)).toEqual([
      "Error",
      "TypeError",
    ]);
    expect(JSON.stringify(sanitized)).not.toContain(syntheticSecret);
  });

  it("breadcrumb、request、user、message を許可フィールドに含めない", () => {
    const event = {
      request: { url: "https://example.test/?token=secret" },
      user: { id: "synthetic-user" },
      breadcrumbs: [{ type: "http", data: { url: "https://example.test" } }],
      message: "untrusted message",
    } as Event;

    expect(sanitizeSentryEvent(event)).toEqual({});
  });
});

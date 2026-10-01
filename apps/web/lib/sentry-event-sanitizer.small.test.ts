import type { Event } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { sanitizeSentryEvent } from "./sentry-event-sanitizer";

describe("sanitizeSentryEvent", () => {
  const syntheticSecret = "SYNTHETIC_ACCESS_TOKEN_MARKER";

  it("HTTP breadcrumbのqueryと未知dataを送信対象から除外する", () => {
    const event = {
      breadcrumbs: [
        {
          type: "http",
          data: {
            url: "https://api.example.test/oauth2/verify",
            "http.request.method": "GET",
            status_code: 200,
            "http.query": `?access_token=${syntheticSecret}`,
            unknownCredentialField: syntheticSecret,
          },
        },
      ],
    } as Event;

    const sanitizedEvent = sanitizeSentryEvent(event);

    expect(JSON.stringify(sanitizedEvent)).not.toContain(syntheticSecret);
    expect(sanitizedEvent.breadcrumbs?.[0]?.data).toEqual({
      url: "https://api.example.test/oauth2/verify",
      "http.request.method": "GET",
      status_code: 200,
    });
  });

  it("HTTP breadcrumbのURLからquery、fragment、userinfoを除去する", () => {
    const event = {
      breadcrumbs: [
        {
          category: "http",
          data: {
            url: `https://user:${syntheticSecret}@api.example.test/verify?token=${syntheticSecret}#${syntheticSecret}`,
            "http.request.method": "GET",
            status_code: 200,
          },
        },
      ],
    } as Event;

    const sanitizedEvent = sanitizeSentryEvent(event);

    expect(sanitizedEvent.breadcrumbs?.[0]?.data).toEqual({
      url: "https://api.example.test/verify",
      "http.request.method": "GET",
      status_code: 200,
    });
    expect(JSON.stringify(sanitizedEvent)).not.toContain(syntheticSecret);
  });

  it("URLを安全に処理できない場合はURLを保持しない", () => {
    const event = {
      breadcrumbs: [
        {
          type: "http",
          data: {
            url: "https://[invalid-url",
            "http.request.method": "GET",
            status_code: 500,
          },
        },
      ],
    } as Event;

    const sanitizedEvent = sanitizeSentryEvent(event);

    expect(sanitizedEvent.breadcrumbs?.[0]?.data).toEqual({
      "http.request.method": "GET",
      status_code: 500,
    });
  });

  it("安全なHTTP dataを維持し、HTTP以外のbreadcrumbを変更しない", () => {
    const nonHttpBreadcrumb = {
      category: "log",
      message: "authentication completed",
      data: { detail: "kept" },
    };
    const event = {
      breadcrumbs: [
        {
          type: "http",
          data: {
            url: "https://api.example.test/verify",
            "http.request.method": "POST",
            status_code: 204,
          },
        },
        nonHttpBreadcrumb,
      ],
    } as Event;

    const sanitizedEvent = sanitizeSentryEvent(event);

    expect(sanitizedEvent.breadcrumbs?.[0]?.data).toEqual({
      url: "https://api.example.test/verify",
      "http.request.method": "POST",
      status_code: 204,
    });
    expect(sanitizedEvent.breadcrumbs?.[1]).toBe(nonHttpBreadcrumb);
    expect(sanitizedEvent.breadcrumbs?.[1]).toEqual(nonHttpBreadcrumb);
  });

  it("requestとuserを削除してもeventを返す", () => {
    const event = {
      request: { url: "https://example.test/" },
      user: { id: "synthetic-user" },
      message: "synthetic exception",
    } as Event;

    const sanitizedEvent = sanitizeSentryEvent(event);

    expect(sanitizedEvent).toBe(event);
    expect(sanitizedEvent.request).toBeUndefined();
    expect(sanitizedEvent.user).toBeUndefined();
    expect(sanitizedEvent.message).toBe("synthetic exception");
  });
});

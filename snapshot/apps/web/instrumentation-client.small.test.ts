import * as Sentry from "@sentry/nextjs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const transportState = vi.hoisted(() => ({ events: [] as unknown[] }));
type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type SentryTransportFactory = NonNullable<SentryInitOptions["transport"]>;
type SentryEnvelope = Parameters<ReturnType<SentryTransportFactory>["send"]>[0];

vi.mock("@sentry/nextjs", async (importOriginal) => {
  const sentry = await importOriginal<typeof import("@sentry/nextjs")>();
  return {
    ...sentry,
    withScope: sentry.withScope,
    captureException: sentry.captureException,
    init(options: SentryInitOptions) {
      const transport: SentryTransportFactory = () => ({
        send(envelope: SentryEnvelope) {
          for (const item of envelope[1]) {
            if (item[0].type === "event") transportState.events.push(item[1]);
          }
          return Promise.resolve({ statusCode: 200 });
        },
        flush: async () => true,
      });
      return sentry.init({ ...options, tracesSampleRate: 0, transport });
    },
  };
});

async function waitForTransport(count: number): Promise<void> {
  await vi.waitFor(
    () => expect(transportState.events.length).toBeGreaterThanOrEqual(count),
    { timeout: 2_000 },
  );
}

describe("browser Sentry capture wiring", () => {
  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "production");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_RELEASE", "browser-test-release-1");
    await import("./instrumentation-client");
  });

  afterEach(() => {
    transportState.events.length = 0;
  });

  it("explicit browser capture filters raw errors, breadcrumbs, contexts, extras, and user data", async () => {
    Sentry.withScope((scope) => {
      scope.setUser({ id: "BROWSER_SYNTHETIC_USER" });
      scope.addBreadcrumb({
        category: "auth",
        message: "BROWSER_SYNTHETIC_BREADCRUMB",
        data: { token: "BROWSER_SYNTHETIC_BREADCRUMB_DATA" },
      });
      scope.setContext("sensitive", { token: "BROWSER_SYNTHETIC_CONTEXT" });
      scope.setExtra("sensitive", { token: "BROWSER_SYNTHETIC_EXTRA" });
      class BROWSER_SYNTHETIC_ERROR_TYPE extends Error {}
      Sentry.captureException(
        new BROWSER_SYNTHETIC_ERROR_TYPE("BROWSER_SYNTHETIC_EXCEPTION", {
          cause: new TypeError("BROWSER_SYNTHETIC_CAUSE"),
        }),
      );
    });
    await waitForTransport(1);

    expect(transportState.events).toHaveLength(1);
    const event = transportState.events[0];
    expect(event).toMatchObject({
      level: "error",
      environment: "production",
      release: "browser-test-release-1",
      exception: {
        values: [
          { type: "TypeError", value: "Unexpected server operation failure" },
          { type: "Error", value: "Unexpected server operation failure" },
        ],
      },
    });
    const serializedEvent = JSON.stringify(event);
    for (const secret of [
      "BROWSER_SYNTHETIC_USER",
      "BROWSER_SYNTHETIC_BREADCRUMB",
      "BROWSER_SYNTHETIC_BREADCRUMB_DATA",
      "BROWSER_SYNTHETIC_CONTEXT",
      "BROWSER_SYNTHETIC_EXTRA",
      "BROWSER_SYNTHETIC_EXCEPTION",
      "BROWSER_SYNTHETIC_CAUSE",
      "BROWSER_SYNTHETIC_ERROR_TYPE",
    ]) {
      expect(serializedEvent).not.toContain(secret);
    }
    expect(event).not.toHaveProperty("user");
    expect(event).not.toHaveProperty("breadcrumbs");
    expect(event).not.toHaveProperty("contexts");
    expect(event).not.toHaveProperty("extra");
  });

  it("automatic browser exceptions are sanitized before transport", async () => {
    const error = new Error("BROWSER_AUTO_SYNTHETIC_EXCEPTION", {
      cause: new Error("BROWSER_AUTO_SYNTHETIC_CAUSE"),
    });
    error.name = "BROWSER_AUTO_SYNTHETIC_ERROR_TYPE";
    Sentry.withScope((scope) => {
      scope.setUser({ id: "BROWSER_AUTO_SYNTHETIC_USER" });
      scope.addBreadcrumb({
        category: "auth",
        message: "BROWSER_AUTO_SYNTHETIC_BREADCRUMB",
        data: { token: "BROWSER_AUTO_SYNTHETIC_BREADCRUMB_DATA" },
      });
      scope.setContext("sensitive", {
        token: "BROWSER_AUTO_SYNTHETIC_CONTEXT",
      });
      scope.setExtra("sensitive", { token: "BROWSER_AUTO_SYNTHETIC_EXTRA" });
      window.dispatchEvent(
        new ErrorEvent("error", {
          message: error.message,
          error,
          filename: "https://example.test/BROWSER_AUTO_SYNTHETIC_FILE.js",
        }),
      );
    });
    await waitForTransport(1);

    expect(transportState.events.length).toBeGreaterThan(0);
    const serializedEvents = JSON.stringify(transportState.events);
    for (const secret of [
      "BROWSER_AUTO_SYNTHETIC_EXCEPTION",
      "BROWSER_AUTO_SYNTHETIC_CAUSE",
      "BROWSER_AUTO_SYNTHETIC_ERROR_TYPE",
      "BROWSER_AUTO_SYNTHETIC_FILE",
      "BROWSER_AUTO_SYNTHETIC_USER",
      "BROWSER_AUTO_SYNTHETIC_BREADCRUMB",
      "BROWSER_AUTO_SYNTHETIC_BREADCRUMB_DATA",
      "BROWSER_AUTO_SYNTHETIC_CONTEXT",
      "BROWSER_AUTO_SYNTHETIC_EXTRA",
    ]) {
      expect(serializedEvents).not.toContain(secret);
    }
    expect(transportState.events[0]).toMatchObject({
      environment: "production",
      release: "browser-test-release-1",
      exception: {
        values: [
          { type: "Error", value: "Unexpected server operation failure" },
          { type: "Error", value: "Unexpected server operation failure" },
        ],
      },
    });
  });
});

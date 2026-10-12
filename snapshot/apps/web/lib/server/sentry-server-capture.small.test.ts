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
      return sentry.init({
        ...options,
        tracesSampleRate: 0,
        transport,
      });
    },
  };
});

async function waitForTransport(): Promise<void> {
  await vi.waitFor(
    () => expect(transportState.events.length).toBeGreaterThan(0),
    {
      timeout: 2_000,
    },
  );
}

describe("server Sentry capture wiring", () => {
  beforeAll(async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "production");
    vi.stubEnv("SENTRY_RELEASE", "test-release-1");
    await import("../../sentry.server.config");
  });

  afterEach(() => {
    transportState.events.length = 0;
  });

  it("explicit server reports pass through the configured beforeSend", async () => {
    const { reportUnexpectedServerException } = await import(
      "./server-observability"
    );
    Sentry.withScope((scope) => {
      scope.setUser({ id: "SYNTHETIC_USER_ID", email: "SYNTHETIC_USER_EMAIL" });
      scope.addBreadcrumb({
        category: "auth",
        message: "SYNTHETIC_BREADCRUMB_MESSAGE",
        data: { token: "SYNTHETIC_BREADCRUMB_DATA" },
      });
      scope.setContext("nested_sensitive_context", {
        nested: { credential: "SYNTHETIC_CONTEXT_SECRET" },
      });
      scope.setExtra("nested_sensitive_extra", {
        nested: { credential: "SYNTHETIC_EXTRA_SECRET" },
      });
      class SYNTHETIC_ERROR_TYPE extends Error {}
      const error = new SYNTHETIC_ERROR_TYPE("SYNTHETIC_EXCEPTION_MESSAGE", {
        cause: new Error("SYNTHETIC_CAUSE_SECRET"),
      });
      reportUnexpectedServerException(error, "staff.read");
    });
    await waitForTransport();

    expect(transportState.events).toHaveLength(1);
    expect(transportState.events[0]).toMatchObject({
      level: "error",
      environment: "production",
      release: "test-release-1",
      tags: { "timecard.operation": "staff.read" },
      exception: {
        values: [
          { type: "Error", value: "Unexpected server operation failure" },
        ],
      },
    });
    const serializedEvent = JSON.stringify(transportState.events[0]);
    for (const secret of [
      "SYNTHETIC_EXCEPTION_MESSAGE",
      "SYNTHETIC_CAUSE_SECRET",
      "SYNTHETIC_ERROR_TYPE",
      "SYNTHETIC_USER_ID",
      "SYNTHETIC_USER_EMAIL",
      "SYNTHETIC_BREADCRUMB_MESSAGE",
      "SYNTHETIC_BREADCRUMB_DATA",
      "SYNTHETIC_CONTEXT_SECRET",
      "SYNTHETIC_EXTRA_SECRET",
    ]) {
      expect(serializedEvent).not.toContain(secret);
    }
    expect(transportState.events[0]).not.toHaveProperty("request");
    expect(transportState.events[0]).not.toHaveProperty("user");
    expect(transportState.events[0]).not.toHaveProperty("breadcrumbs");
    expect(transportState.events[0]).not.toHaveProperty("contexts");
    expect(transportState.events[0]).not.toHaveProperty("extra");
  });

  it("the real onRequestError captureRequestError path is sanitized before transport", async () => {
    const { onRequestError } = await import("../../instrumentation");
    Sentry.withScope((scope) => {
      scope.setUser({ id: "AUTO_SYNTHETIC_USER" });
      scope.addBreadcrumb({
        category: "auth",
        message: "AUTO_SYNTHETIC_BREADCRUMB",
        data: { token: "AUTO_SYNTHETIC_BREADCRUMB_DATA" },
      });
      scope.setContext("auto_sensitive_context", {
        nested: { token: "AUTO_SYNTHETIC_CONTEXT" },
      });
      scope.setExtra("auto_sensitive_extra", {
        nested: { token: "AUTO_SYNTHETIC_EXTRA" },
      });
      const error = new Error("AUTO_SYNTHETIC_EXCEPTION", {
        cause: new Error("AUTO_SYNTHETIC_CAUSE"),
      });
      error.name = "AUTO_SYNTHETIC_ERROR_TYPE";
      onRequestError(
        error,
        {
          path: "/staff/AUTO_SYNTHETIC_REQUEST?token=AUTO_SYNTHETIC_REQUEST",
          method: "POST",
          headers: { authorization: "AUTO_SYNTHETIC_REQUEST" },
        },
        {
          routerKind: "App Router",
          routePath: "/staff/AUTO_SYNTHETIC_ROUTE",
          routeType: "render",
        },
      );
    });
    await waitForTransport();

    expect(transportState.events.length).toBeGreaterThan(0);
    const serializedEvents = JSON.stringify(transportState.events);
    for (const secret of [
      "AUTO_SYNTHETIC_EXCEPTION",
      "AUTO_SYNTHETIC_CAUSE",
      "AUTO_SYNTHETIC_ERROR_TYPE",
      "AUTO_SYNTHETIC_REQUEST",
      "AUTO_SYNTHETIC_ROUTE",
      "AUTO_SYNTHETIC_USER",
      "AUTO_SYNTHETIC_BREADCRUMB",
      "AUTO_SYNTHETIC_BREADCRUMB_DATA",
      "AUTO_SYNTHETIC_CONTEXT",
      "AUTO_SYNTHETIC_EXTRA",
    ]) {
      expect(serializedEvents).not.toContain(secret);
    }
    expect(transportState.events[0]).toMatchObject({
      level: "error",
      environment: "production",
      release: "test-release-1",
      exception: {
        values: [
          { type: "Error", value: "Unexpected server operation failure" },
          { type: "Error", value: "Unexpected server operation failure" },
        ],
      },
    });
  });
});

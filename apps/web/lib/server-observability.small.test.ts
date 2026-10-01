import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  scope: { setTag: vi.fn() },
  withScope: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
  withScope: mocks.withScope,
}));

import {
  reportLineServiceUnavailable,
  reportUnexpectedServerException,
} from "./server-observability";

afterEach(() => {
  mocks.captureException.mockReset();
  mocks.captureMessage.mockReset();
  mocks.scope.setTag.mockReset();
  mocks.withScope.mockReset();
});

describe("reportUnexpectedServerException", () => {
  test("sets the operation tag and captures one sanitized exception", () => {
    mocks.withScope.mockImplementation((callback) => callback(mocks.scope));

    reportUnexpectedServerException(
      new Error("database failure"),
      "staff.read",
    );

    expect(mocks.scope.setTag).toHaveBeenCalledWith(
      "timecard.operation",
      "staff.read",
    );
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  test("keeps a safe error type and original stack frames without the message", () => {
    class SafeDomainError extends Error {}

    const error = new SafeDomainError("synthetic-secret-marker");
    error.stack = [
      "SafeDomainError: synthetic-secret-marker",
      "    at safeOriginalFrame (server.ts:10:20)",
      "    at syntheticSecretMarker (server.ts:11:21)",
      "    at synthetic-secret-marker (server.ts:11:21)",
      "    at synthetic-secret-marker",
      "    at synthetic-secret-marker:1:2",
      "    at https://example.test/file.js?token=synthetic-secret-marker:1:2",
      "not a stack frame",
    ].join("\n");
    mocks.withScope.mockImplementation((callback) => callback(mocks.scope));

    reportUnexpectedServerException(error, "staff.read");

    const captured = mocks.captureException.mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.name).toBe("SafeDomainError");
    expect(captured.message).toBe("Unexpected server operation failure");
    expect(captured.stack).toContain("at <anonymous> (10:20)");
    expect(captured.message).not.toContain("synthetic-secret-marker");
    expect(captured.stack).not.toContain("synthetic-secret-marker");
    expect(captured.stack).not.toContain("not a stack frame");
  });

  test("does not forward non-Error thrown values", () => {
    mocks.withScope.mockImplementation((callback) => callback(mocks.scope));

    reportUnexpectedServerException("synthetic-secret-marker", "staff.read");

    const captured = mocks.captureException.mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.name).toBe("Error");
    expect(captured.message).toBe("Unexpected server operation failure");
    expect(captured.stack).not.toContain("synthetic-secret-marker");
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("reportLineServiceUnavailable", () => {
  test("sets safe tags and captures one warning message", () => {
    mocks.withScope.mockImplementation((callback) => callback(mocks.scope));

    reportLineServiceUnavailable("auth.action.create_staff_session", "timeout");

    expect(mocks.withScope).toHaveBeenCalledTimes(1);
    expect(mocks.scope.setTag).toHaveBeenCalledWith(
      "timecard.operation",
      "auth.action.create_staff_session",
    );
    expect(mocks.scope.setTag).toHaveBeenCalledWith(
      "timecard.line_failure_reason",
      "timeout",
    );
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "LINE service unavailable",
      "warning",
    );
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});

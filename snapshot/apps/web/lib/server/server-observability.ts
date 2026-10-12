import "server-only";

import * as Sentry from "@sentry/nextjs";

export type LineServiceUnavailableReason =
  | "timeout"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "invalid_response";

const SAFE_ERROR_MESSAGE = "Unexpected server operation failure";
const SAFE_ERROR_TYPE_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

function isError(error: unknown): error is Error {
  try {
    return error instanceof Error;
  } catch {
    return false;
  }
}

function readProperty(target: object, property: PropertyKey): unknown {
  try {
    return Reflect.get(target, property);
  } catch {
    return undefined;
  }
}

function safeErrorType(error: Error): string {
  let prototype: object | null = null;
  try {
    prototype = Object.getPrototypeOf(error);
  } catch {
    // Use the generic type when even inspecting the prototype is unsafe.
  }

  const constructorValue = prototype
    ? readProperty(prototype, "constructor")
    : undefined;
  const candidates = [
    typeof constructorValue === "object" && constructorValue !== null
      ? readProperty(constructorValue, "name")
      : typeof constructorValue === "function"
        ? readProperty(constructorValue, "name")
        : undefined,
    readProperty(error, "name"),
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      SAFE_ERROR_TYPE_PATTERN.test(candidate)
    ) {
      return candidate;
    }
  }

  return "Error";
}

function createSafeError(error: unknown): Error {
  const safeType = isError(error) ? safeErrorType(error) : "Error";
  const safeError = new Error(SAFE_ERROR_MESSAGE);
  safeError.name = safeType;

  safeError.stack = undefined;

  return safeError;
}

export function reportUnexpectedServerException(
  error: unknown,
  operation: string,
) {
  Sentry.withScope((scope) => {
    scope.setTag("timecard.operation", operation);
    // Server Actions can receive authentication credentials. Do not forward an
    // arbitrary exception message or object because it may contain a token.
    Sentry.captureException(createSafeError(error));
  });
}

export function reportLineServiceUnavailable(
  operation: string,
  reason: LineServiceUnavailableReason,
) {
  Sentry.withScope((scope) => {
    scope.setTag("timecard.operation", operation);
    scope.setTag("timecard.line_failure_reason", reason);
    Sentry.captureMessage("LINE service unavailable", "warning");
  });
}

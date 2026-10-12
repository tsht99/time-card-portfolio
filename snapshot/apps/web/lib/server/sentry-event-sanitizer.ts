import type { Event } from "@sentry/nextjs";

const safeEnvironmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const safeReleasePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const safeOperationPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,7}$/;
const safeErrorTypes = new Set([
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AggregateError",
  "DOMException",
  "AbortError",
]);
const lineFailureReasons = new Set([
  "timeout",
  "rate_limited",
  "upstream_error",
  "network_error",
  "invalid_response",
]);
const safeMessages = new Set(["LINE service unavailable"]);

/**
 * Rebuilds an event from explicitly approved diagnostic fields. This module is
 * intentionally safe to import in client and server SDK configurations.
 */
export function sanitizeSentryEvent<T extends Event>(event: T): T {
  const sanitized: Event = {};

  if (
    typeof event.event_id === "string" &&
    /^[a-f0-9]{32}$/i.test(event.event_id)
  ) {
    sanitized.event_id = event.event_id;
  }
  if (typeof event.timestamp === "number" && Number.isFinite(event.timestamp)) {
    sanitized.timestamp = event.timestamp;
  }
  if (event.platform === "javascript") sanitized.platform = "javascript";
  if (
    event.level === "fatal" ||
    event.level === "error" ||
    event.level === "warning"
  ) {
    sanitized.level = event.level;
  }
  if (isSafeString(event.environment, safeEnvironmentPattern)) {
    sanitized.environment = event.environment;
  }
  if (isSafeString(event.release, safeReleasePattern)) {
    sanitized.release = event.release;
  }

  const tags: Record<string, string> = {};
  const operation = event.tags?.["timecard.operation"];
  if (isSafeString(operation, safeOperationPattern)) {
    tags["timecard.operation"] = operation;
  }
  const lineFailureReason = event.tags?.["timecard.line_failure_reason"];
  if (
    typeof lineFailureReason === "string" &&
    lineFailureReasons.has(lineFailureReason)
  ) {
    tags["timecard.line_failure_reason"] = lineFailureReason;
  }
  if (Object.keys(tags).length > 0) sanitized.tags = tags;

  const exceptions = event.exception?.values?.map((exception) => {
    const type =
      typeof exception.type === "string" && safeErrorTypes.has(exception.type)
        ? exception.type
        : "Error";
    return { type, value: "Unexpected server operation failure" };
  });
  if (exceptions && exceptions.length > 0) {
    sanitized.exception = { values: exceptions };
  } else if (
    typeof event.message === "string" &&
    safeMessages.has(event.message)
  ) {
    sanitized.message = event.message;
  }

  return sanitized as T;
}

function isSafeString(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

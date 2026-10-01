import * as Sentry from "@sentry/nextjs";

export type LineServiceUnavailableReason =
  | "timeout"
  | "rate_limited"
  | "upstream_error"
  | "network_error"
  | "invalid_response";

const SAFE_ERROR_MESSAGE = "Unexpected server operation failure";
const SAFE_ERROR_TYPE_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const MAX_SAFE_STACK_FRAMES = 20;
const MAX_SAFE_STACK_LENGTH = 32_768;
const MAX_SAFE_STACK_FRAME_LENGTH = 1_024;
const STACK_FRAME_WITH_FUNCTION_PATTERN =
  /^at (.+?) \([^()\r\n]+:(\d{1,9}):(\d{1,9})\)$/;
const STACK_FRAME_WITHOUT_FUNCTION_PATTERN =
  /^at [^()\r\n]+:(\d{1,9}):(\d{1,9})$/;

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

function safeStackFrames(error: Error): string[] {
  const stack = readProperty(error, "stack");
  if (typeof stack !== "string") {
    return [];
  }

  return stack
    .slice(0, MAX_SAFE_STACK_LENGTH)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      if (line.length <= 3 || line.length > MAX_SAFE_STACK_FRAME_LENGTH) {
        return undefined;
      }

      const withFunction = line.match(STACK_FRAME_WITH_FUNCTION_PATTERN);
      if (withFunction) {
        const [, , lineNumber, columnNumber] = withFunction;
        return `at <anonymous> (${lineNumber}:${columnNumber})`;
      }

      const withoutFunction = line.match(STACK_FRAME_WITHOUT_FUNCTION_PATTERN);
      if (withoutFunction) {
        const [, lineNumber, columnNumber] = withoutFunction;
        return `at <anonymous> (${lineNumber}:${columnNumber})`;
      }

      return undefined;
    })
    .filter((line): line is string => line !== undefined)
    .slice(0, MAX_SAFE_STACK_FRAMES);
}

function createSafeError(error: unknown): Error {
  const safeType = isError(error) ? safeErrorType(error) : "Error";
  const safeError = new Error(SAFE_ERROR_MESSAGE);
  safeError.name = safeType;

  const frames = isError(error) ? safeStackFrames(error) : [];
  safeError.stack = [`${safeType}: ${SAFE_ERROR_MESSAGE}`, ...frames].join(
    "\n",
  );

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

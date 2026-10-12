import { isSafeAttendanceId } from "../attendance-id.ts";

const attendanceCurrentStateProjectionRebuildStages = [
  "acquire_rebuild_lock",
  "mark_projection_not_ready",
  "lock_event_store",
  "read_event_store",
  "deserialize_event",
  "replay_event_stream",
  "replace_projection",
  "mark_projection_ready",
  "replace_projection_transaction",
  "release_rebuild_lock",
] as const;

export type AttendanceCurrentStateProjectionRebuildStage =
  (typeof attendanceCurrentStateProjectionRebuildStages)[number];

const safeJavaScriptIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const maximumSourceStackLength = 32 * 1024;
const maximumSourceStackLineLength = 2 * 1024;
const maximumSourceStackFrames = 32;
const maximumStackNumberDigits = 9;

function safeErrorType(error: unknown): string {
  let isError = false;
  try {
    isError = error instanceof Error;
  } catch {
    return "Error";
  }
  if (!isError) return "Error";
  const sourceError = error as Error;

  let candidate: unknown;
  try {
    candidate = sourceError.name;
  } catch {
    candidate = undefined;
  }
  if (typeof candidate === "string" && safeJavaScriptIdentifier.test(candidate))
    return candidate;

  try {
    candidate = sourceError.constructor.name;
  } catch {
    candidate = undefined;
  }
  return typeof candidate === "string" &&
    safeJavaScriptIdentifier.test(candidate)
    ? candidate
    : "Error";
}

function safeErrorStack(error: unknown): string | undefined {
  try {
    if (!(error instanceof Error)) return undefined;
    const stack = error.stack;
    return typeof stack === "string"
      ? stack.slice(0, maximumSourceStackLength)
      : undefined;
  } catch {
    return undefined;
  }
}

function sourceStackFrames(error: unknown): string[] {
  const stack = safeErrorStack(error);
  if (stack === undefined) return [];

  const frames: string[] = [];
  for (const line of stack.split("\n").slice(1)) {
    if (frames.length >= maximumSourceStackFrames) break;
    const boundedLine = line.slice(0, maximumSourceStackLineLength);
    if (!/^\s*at\s+/.test(boundedLine)) continue;
    const match = new RegExp(
      `:(\\d{1,${maximumStackNumberDigits}}):(\\d{1,${maximumStackNumberDigits}})\\)?\\s*$`,
    ).exec(boundedLine);
    if (match === null) continue;
    const lineNumber = Number(match[1]);
    const columnNumber = Number(match[2]);
    if (
      !Number.isSafeInteger(lineNumber) ||
      !Number.isSafeInteger(columnNumber) ||
      lineNumber < 1 ||
      columnNumber < 1
    )
      continue;
    frames.push(`at <anonymous> (${lineNumber}:${columnNumber})`);
  }
  return frames;
}

export class AttendanceCurrentStateProjectionRebuildError extends Error {
  readonly stage: AttendanceCurrentStateProjectionRebuildStage;
  declare readonly attendanceId?: string;
  readonly sourceErrorType: string;
  readonly sourceStackFrames: readonly string[];

  constructor(
    stage: AttendanceCurrentStateProjectionRebuildStage,
    sourceError: unknown,
    attendanceId?: unknown,
  ) {
    super("Attendance Current State Projection rebuild failed.");
    this.name = "AttendanceCurrentStateProjectionRebuildError";
    this.stage = stage;
    if (isSafeAttendanceId(attendanceId))
      Object.defineProperty(this, "attendanceId", {
        configurable: false,
        enumerable: true,
        value: attendanceId,
        writable: false,
      });
    this.sourceErrorType = safeErrorType(sourceError);
    this.sourceStackFrames = sourceStackFrames(sourceError);
  }
}

export function createAttendanceCurrentStateProjectionRebuildError(
  stage: AttendanceCurrentStateProjectionRebuildStage,
  sourceError: unknown,
  attendanceId?: unknown,
): AttendanceCurrentStateProjectionRebuildError {
  if (sourceError instanceof AttendanceCurrentStateProjectionRebuildError)
    return sourceError;
  return new AttendanceCurrentStateProjectionRebuildError(
    stage,
    sourceError,
    attendanceId,
  );
}

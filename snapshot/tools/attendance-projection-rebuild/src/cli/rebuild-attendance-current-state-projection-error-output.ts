import { AttendanceCurrentStateProjectionRebuildError } from "@repo/attendance/infrastructure";

const genericFailureMessage =
  "Attendance Current State Projection rebuild failed.";

export function formatAttendanceCurrentStateProjectionRebuildFailure(
  error: unknown,
): string {
  let isDiagnosticError = false;
  try {
    isDiagnosticError =
      error instanceof AttendanceCurrentStateProjectionRebuildError;
  } catch {
    return genericFailureMessage;
  }
  if (!isDiagnosticError) return genericFailureMessage;

  try {
    const diagnosticError =
      error as AttendanceCurrentStateProjectionRebuildError;
    const lines = [genericFailureMessage, `stage=${diagnosticError.stage}`];

    if (diagnosticError.attendanceId !== undefined)
      lines.push(`attendanceId=${diagnosticError.attendanceId}`);
    lines.push(`errorType=${diagnosticError.sourceErrorType}`);

    if (diagnosticError.sourceStackFrames.length > 0) {
      lines.push("stack:", ...diagnosticError.sourceStackFrames);
    }

    return lines.join("\n");
  } catch {
    return genericFailureMessage;
  }
}

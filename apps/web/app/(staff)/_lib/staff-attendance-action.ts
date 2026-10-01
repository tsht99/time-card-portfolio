import type { LineSessionActionResult } from "../../../lib/auth-types";
import type { StaffAttendanceActionResult } from "../_actions/attendance-actions.ts";

const attendanceTimeOverlapMessage =
  "既存の勤怠と勤務時間が重複しています。時刻を確認してください。";
const staffClockInTimeOverlapMessage =
  "既存の勤怠と勤務時間が重複しています。出勤時刻を確認してください。";
const staffClockOutTimeOverlapMessage =
  "既存の勤怠と勤務時間が重複しているため、退勤を記録できません。管理者に勤怠の確認を依頼してください。管理者による時刻の訂正、または誤って登録された勤怠の取消が必要な場合があります。";

export class AttendanceActionError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AttendanceActionError";
    this.code = code;
  }
}

export function resolveStaffAttendanceErrorMessage(
  error: Error | null,
  eventType: "clock_in" | "clock_out" | undefined,
): string | null {
  if (!error) return null;
  if (
    error instanceof AttendanceActionError &&
    error.code === "ATTENDANCE_TIME_OVERLAP"
  ) {
    if (eventType === "clock_in") return staffClockInTimeOverlapMessage;
    if (eventType === "clock_out") return staffClockOutTimeOverlapMessage;
  }
  return error.message;
}

function throwForFailure(result: StaffAttendanceActionResult): void {
  if (result.success) return;
  const message =
    result.code === "ATTENDANCE_TIME_OVERLAP"
      ? attendanceTimeOverlapMessage
      : result.message;
  throw new AttendanceActionError(message, result.code);
}

export async function executeStaffAttendanceAction<T>(
  action: (input: T) => Promise<StaffAttendanceActionResult>,
  input: T,
  reauthenticate: () => Promise<LineSessionActionResult>,
): Promise<void> {
  let result = await action(input);
  if (!result.success && result.code === "SESSION_EXPIRED") {
    const session = await reauthenticate();
    if (!session.success)
      throw new AttendanceActionError(session.message, session.code);
    result = await action(input);
  }
  throwForFailure(result);
}

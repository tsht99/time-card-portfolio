import type { clockStaffAttendanceAction } from "../_actions/attendance-actions.ts";
import type { createStaffLineSessionAction } from "../_actions/auth-actions.ts";

type StaffAttendanceActionResult = Awaited<
  ReturnType<typeof clockStaffAttendanceAction>
>;

export class AttendanceActionError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AttendanceActionError";
    this.code = code;
  }
}

export async function executeStaffAttendanceAction<T>(
  action: (input: T) => Promise<StaffAttendanceActionResult>,
  input: T,
  reauthenticate: () => ReturnType<typeof createStaffLineSessionAction>,
  expectedSubjectUserId: string,
): Promise<StaffAttendanceActionResult> {
  const result = await action(input);
  if (result.serverError?.code !== "SESSION_EXPIRED") return result;

  const session = await reauthenticate();
  if (session.serverError) {
    const error = new Error(session.serverError.message);
    Object.assign(error, { code: session.serverError.code });
    throw error;
  }
  if (session.validationErrors)
    throw new Error("リクエスト形式が正しくありません。");
  if (!session.data) throw new Error("認証処理に失敗しました。");
  if (session.data.userId !== expectedSubjectUserId) {
    const error = new Error("認証主体が変更されたため、操作を中止しました。");
    Object.assign(error, { code: "AUTH_SUBJECT_CHANGED" });
    throw error;
  }

  // Reauthentication only restores the session. Attendance may have changed
  // since the displayed snapshot was loaded, so the original punch must be
  // reviewed and submitted explicitly after refreshing that snapshot.
  return result;
}

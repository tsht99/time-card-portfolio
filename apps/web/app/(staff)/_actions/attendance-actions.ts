"use server";

import {
  AttendanceClockAlreadyWorkingError,
  AttendanceClockCommandRejectedError,
  AttendanceClockNotWorkingError,
  AttendanceClockStaleError,
  AttendanceTimeOverlapError,
} from "@repo/attendance";
import { createAttendanceEventRequestSchema } from "@repo/contracts";
import { revalidatePath } from "next/cache";
import type { AuthenticatedTimeCardUser } from "../../../lib/auth-types";
import { createAttendanceApplication } from "../../../lib/server/attendance-composition";
import { resolveStaffAuthSession } from "../../../lib/server/auth-session";
import { getServerReferenceTime } from "../../../lib/server/reference-time";
import { reportUnexpectedServerException } from "../../../lib/server-observability";

const invalidRequestMessage = "リクエスト形式が正しくありません。";

export type StaffAttendanceActionResult =
  | { success: true }
  | {
      success: false;
      code?:
        | "SESSION_EXPIRED"
        | "ATTENDANCE_TIME_OVERLAP"
        | "ATTENDANCE_CLOCK_STALE";
      message: string;
    };

function invalidRequest(): StaffAttendanceActionResult {
  return { success: false, message: invalidRequestMessage };
}

async function resolveActor(): Promise<
  | { success: true; actor: AuthenticatedTimeCardUser }
  | { success: false; kind: "session-expired" | "unavailable" }
> {
  const session = await resolveStaffAuthSession();
  if (session.status === "missing")
    return { success: false, kind: "session-expired" };
  if (session.status !== "ready")
    return { success: false, kind: "unavailable" };
  return { success: true, actor: session.user };
}

function sessionExpired(): StaffAttendanceActionResult {
  return {
    success: false,
    code: "SESSION_EXPIRED",
    message: "ログイン状態が切れています。",
  };
}

function application(referenceTime: Date) {
  return createAttendanceApplication({
    now: () => referenceTime,
  });
}

export async function clockStaffAttendanceAction(
  input: unknown,
): Promise<StaffAttendanceActionResult> {
  const parsed = createAttendanceEventRequestSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const session = await resolveActor();
    if (!session.success)
      return session.kind === "session-expired"
        ? sessionExpired()
        : { success: false, message: "打刻の保存に失敗しました。" };
    const serverReferenceTime = getServerReferenceTime();
    await application(serverReferenceTime).clock(session.actor, parsed.data);
    revalidatePath("/clock");
    return { success: true };
  } catch (error) {
    if (error instanceof AttendanceTimeOverlapError)
      return {
        success: false,
        code: "ATTENDANCE_TIME_OVERLAP",
        message: error.message,
      };
    if (error instanceof AttendanceClockStaleError)
      return {
        success: false,
        code: "ATTENDANCE_CLOCK_STALE",
        message:
          "勤怠の状態が更新されています。最新の状態を確認してから、もう一度操作してください。",
      };
    if (error instanceof AttendanceClockAlreadyWorkingError)
      return {
        success: false,
        message: "退勤していない勤務があります。先に退勤してください。",
      };
    if (error instanceof AttendanceClockNotWorkingError)
      return {
        success: false,
        message: "出勤していないため、退勤できません。",
      };
    if (error instanceof AttendanceClockCommandRejectedError)
      return { success: false, message: error.message };
    reportUnexpectedServerException(error, "staff.attendance.action.clock");
    return { success: false, message: "打刻の保存に失敗しました。" };
  }
}

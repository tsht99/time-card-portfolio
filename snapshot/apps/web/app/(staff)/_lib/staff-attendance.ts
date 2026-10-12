import "server-only";

import type { AttendanceApplicationActor } from "@repo/attendance";
import { createTimeCardAttendanceApplication } from "../../../lib/server/attendance-composition";
import { reportUnexpectedServerException } from "../../../lib/server/server-observability";
import type {
  StaffAttendanceHistoryReadState,
  StaffCurrentAttendanceReadState,
} from "./staff-attendance-types";

const currentReadErrorMessage = "現在の勤怠を取得できませんでした。";
const historyReadErrorMessage = "勤怠履歴を取得できませんでした。";

export async function loadStaffCurrentAttendance(
  actor: AttendanceApplicationActor,
  referenceTime: Date,
): Promise<StaffCurrentAttendanceReadState> {
  try {
    const current = await createTimeCardAttendanceApplication({
      now: () => referenceTime,
    }).getStaffCurrentAttendance(actor);
    return { status: "ready", data: current };
  } catch (error) {
    reportUnexpectedServerException(error, "staff.attendance.read.current");
    return { status: "error", message: currentReadErrorMessage };
  }
}

export async function loadStaffAttendanceHistory(
  actor: AttendanceApplicationActor,
  month: string,
): Promise<StaffAttendanceHistoryReadState> {
  try {
    const history = await createTimeCardAttendanceApplication(
      {},
    ).getAttendanceHistory(actor, month);
    return { status: "ready", data: history };
  } catch (error) {
    reportUnexpectedServerException(error, "staff.attendance.read.history");
    return { status: "error", message: historyReadErrorMessage };
  }
}

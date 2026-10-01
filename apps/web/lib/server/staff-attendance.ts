import "server-only";

import { reportUnexpectedServerException } from "../server-observability";
import type {
  StaffAttendanceHistoryReadState,
  StaffCurrentAttendanceReadState,
} from "../staff-attendance-types";
import { createAttendanceApplication } from "./attendance-composition";

const currentReadErrorMessage = "現在の勤怠を取得できませんでした。";
const historyReadErrorMessage = "勤怠履歴を取得できませんでした。";

export async function loadStaffCurrentAttendance(
  userId: string,
  referenceTime: Date,
): Promise<StaffCurrentAttendanceReadState> {
  try {
    const current = await createAttendanceApplication({
      now: () => referenceTime,
    }).getStaffCurrentAttendance(userId);
    return { status: "ready", data: current };
  } catch (error) {
    reportUnexpectedServerException(error, "staff.attendance.read.current");
    return { status: "error", message: currentReadErrorMessage };
  }
}

export async function loadStaffAttendanceHistory(
  userId: string,
  month: string,
): Promise<StaffAttendanceHistoryReadState> {
  try {
    const history = await createAttendanceApplication({}).getAttendanceHistory(
      userId,
      month,
    );
    return { status: "ready", data: history };
  } catch (error) {
    reportUnexpectedServerException(error, "staff.attendance.read.history");
    return { status: "error", message: historyReadErrorMessage };
  }
}

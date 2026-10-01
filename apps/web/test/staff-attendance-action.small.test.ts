import { describe, expect, test, vi } from "vitest";
import type { StaffAttendanceActionResult } from "../app/(staff)/_actions/attendance-actions.ts";
import {
  AttendanceActionError,
  executeStaffAttendanceAction,
} from "../app/(staff)/_lib/staff-attendance-action.ts";
import type { LineSessionActionResult } from "../lib/auth-types";

const input = { eventType: "clock_in", workPeriod: "day" };
type TestAction = (value: typeof input) => Promise<StaffAttendanceActionResult>;
type TestReauthenticate = () => Promise<LineSessionActionResult>;
const authenticatedUser = {
  userId: "staff-1",
  displayName: "スタッフ",
  role: "staff",
  status: "active",
} as const;

function actionMock(
  ...results: StaffAttendanceActionResult[]
): ReturnType<typeof vi.fn<TestAction>> {
  const action = vi.fn<TestAction>();
  for (const result of results) action.mockResolvedValueOnce(result);
  return action;
}

function reauthenticateMock(
  ...results: LineSessionActionResult[]
): ReturnType<typeof vi.fn<TestReauthenticate>> {
  const reauthenticate = vi.fn<TestReauthenticate>();
  for (const result of results) reauthenticate.mockResolvedValueOnce(result);
  return reauthenticate;
}

function sessionSuccess(): LineSessionActionResult {
  return { success: true as const, user: authenticatedUser };
}

describe("executeStaffAttendanceAction", () => {
  test("最初からsuccessならactionだけを1回実行する", async () => {
    const action = actionMock({ success: true });
    const reauthenticate = reauthenticateMock();

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).resolves.toBeUndefined();
    expect(action).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("SESSION_EXPIRED以外のfailureは再認証せず元のmessageとcodeを保持する", async () => {
    const action = actionMock({
      success: false,
      message: "保存できません。",
    });
    const reauthenticate = reauthenticateMock();

    const error = await executeStaffAttendanceAction(
      action,
      input,
      reauthenticate,
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AttendanceActionError);
    expect(error).toMatchObject({
      message: "保存できません。",
      code: undefined,
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("ATTENDANCE_TIME_OVERLAPは固定文言へ変換する", async () => {
    const action = actionMock({
      success: false,
      code: "ATTENDANCE_TIME_OVERLAP",
      message: "server message",
    });
    const reauthenticate = reauthenticateMock();

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).rejects.toMatchObject({
      message: "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      code: "ATTENDANCE_TIME_OVERLAP",
    });
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("ATTENDANCE_CLOCK_STALEのcodeとmessageを保持する", async () => {
    const action = actionMock({
      success: false,
      code: "ATTENDANCE_CLOCK_STALE",
      message: "最新の状態を確認してから、もう一度操作してください。",
    });
    const reauthenticate = reauthenticateMock();

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).rejects.toMatchObject({
      message: "最新の状態を確認してから、もう一度操作してください。",
      code: "ATTENDANCE_CLOCK_STALE",
    });
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("最初のSESSION_EXPIRED後、再認証成功なら同じinputで1回だけretryする", async () => {
    const action = actionMock(
      {
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
      { success: true },
    );
    const reauthenticate = reauthenticateMock(sessionSuccess());

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).resolves.toBeUndefined();
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[1]?.[0]).toBe(input);
  });

  test("再認証failureならretryせずsessionのmessageとcodeを使う", async () => {
    const action = actionMock({
      success: false,
      code: "SESSION_EXPIRED",
      message: "ログイン状態が切れています。",
    });
    const reauthenticate = reauthenticateMock({
      success: false,
      code: "LINE_AUTH_FAILED",
      message: "再認証できません。",
    });

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).rejects.toMatchObject({
      message: "再認証できません。",
      code: "LINE_AUTH_FAILED",
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  test("retryのSESSION_EXPIREDは再認証せずAttendanceActionErrorへ変換する", async () => {
    const action = actionMock(
      {
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
      {
        success: false,
        code: "SESSION_EXPIRED",
        message: "再試行後もログイン状態が切れています。",
      },
    );
    const reauthenticate = reauthenticateMock(sessionSuccess());

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).rejects.toMatchObject({
      message: "再試行後もログイン状態が切れています。",
      code: "SESSION_EXPIRED",
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  test("retryの通常failureもretry resultを変換する", async () => {
    const action = actionMock(
      {
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
      {
        success: false,
        code: "ATTENDANCE_TIME_OVERLAP",
        message: "server message",
      },
    );
    const reauthenticate = reauthenticateMock(sessionSuccess());

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).rejects.toMatchObject({
      message: "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      code: "ATTENDANCE_TIME_OVERLAP",
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  test("actionのthrowはそのまま伝播しretryしない", async () => {
    const error = new Error("action failed");
    const action = vi
      .fn<(value: typeof input) => Promise<StaffAttendanceActionResult>>()
      .mockRejectedValue(error);
    const reauthenticate = reauthenticateMock();

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).rejects.toBe(error);
    expect(action).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("reauthenticateのthrowはそのまま伝播しactionをretryしない", async () => {
    const error = new Error("reauthentication failed");
    const action = actionMock({
      success: false,
      code: "SESSION_EXPIRED",
      message: "ログイン状態が切れています。",
    });
    const reauthenticate = vi
      .fn<() => Promise<LineSessionActionResult>>()
      .mockRejectedValue(error);

    await expect(
      executeStaffAttendanceAction(action, input, reauthenticate),
    ).rejects.toBe(error);
    expect(action).toHaveBeenCalledTimes(1);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });
});

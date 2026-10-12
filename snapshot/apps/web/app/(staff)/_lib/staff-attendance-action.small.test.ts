import { describe, expect, test, vi } from "vitest";
import type { clockStaffAttendanceAction } from "../_actions/attendance-actions.ts";
import type { createStaffLineSessionAction } from "../_actions/auth-actions.ts";
import { executeStaffAttendanceAction } from "./staff-attendance-action.ts";

type Result = Awaited<ReturnType<typeof clockStaffAttendanceAction>>;
const input = { eventType: "clock_in", workPeriod: "day" };
const subjectUserId = "staff";
type Action = (value: typeof input) => Promise<Result>;
type Reauthenticate = () => ReturnType<typeof createStaffLineSessionAction>;
const success = { data: undefined } as Result;
const expired = {
  serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
} as Result;

describe("executeStaffAttendanceAction", () => {
  test("success, business errors, and validation errors return unchanged without reauthentication", async () => {
    for (const result of [
      success,
      {
        serverError: { code: "ACTION_FAILED", message: "失敗" },
      } as Result,
      { validationErrors: { _errors: ["invalid"] } } as Result,
    ]) {
      const action = vi.fn<Action>().mockResolvedValue(result);
      const reauthenticate = vi.fn<Reauthenticate>();
      await expect(
        executeStaffAttendanceAction(
          action,
          input,
          reauthenticate,
          subjectUserId,
        ),
      ).resolves.toBe(result);
      expect(action).toHaveBeenCalledOnce();
      expect(reauthenticate).not.toHaveBeenCalled();
    }
  });

  test("SESSION_EXPIRED reauthenticates but does not retry the action", async () => {
    const action = vi.fn<Action>().mockResolvedValue(expired);
    const reauthenticate = vi.fn<Reauthenticate>().mockResolvedValue({
      data: {
        userId: "staff",
        displayName: "Staff",
        role: "staff",
        status: "active",
      },
    });
    await expect(
      executeStaffAttendanceAction(
        action,
        input,
        reauthenticate,
        subjectUserId,
      ),
    ).resolves.toBe(expired);
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith(input);
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  test("SESSION_EXPIRED is returned after reauthentication without a second action", async () => {
    const action = vi.fn<Action>().mockResolvedValue(expired);
    const reauthenticate = vi.fn<Reauthenticate>().mockResolvedValue({
      data: {
        userId: "staff",
        displayName: "Staff",
        role: "staff",
        status: "active",
      },
    });
    await expect(
      executeStaffAttendanceAction(
        action,
        input,
        reauthenticate,
        subjectUserId,
      ),
    ).resolves.toBe(expired);
    expect(action).toHaveBeenCalledOnce();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  test("reauthentication error surfaces its own auth error and does not retry", async () => {
    const authError = new Error("LINE auth failed");
    const action = vi.fn<Action>().mockResolvedValue(expired);
    const reauthenticate = vi.fn<Reauthenticate>().mockRejectedValue(authError);
    await expect(
      executeStaffAttendanceAction(
        action,
        input,
        reauthenticate,
        subjectUserId,
      ),
    ).rejects.toBe(authError);
    expect(action).toHaveBeenCalledOnce();
  });

  test("reauthentication native failure is surfaced without converting the action result", async () => {
    const action = vi.fn<Action>().mockResolvedValue(expired);
    const reauthenticate = vi.fn<Reauthenticate>().mockResolvedValue({
      serverError: {
        code: "LINE_AUTH_FAILED",
        message: "LINE認証に失敗しました。",
      },
    });
    await expect(
      executeStaffAttendanceAction(
        action,
        input,
        reauthenticate,
        subjectUserId,
      ),
    ).rejects.toMatchObject({
      message: "LINE認証に失敗しました。",
      code: "LINE_AUTH_FAILED",
    });
    expect(action).toHaveBeenCalledOnce();
  });

  test("reauthentication to another subject aborts without retrying the old operation", async () => {
    const action = vi.fn<Action>().mockResolvedValue(expired);
    const reauthenticate = vi.fn<Reauthenticate>().mockResolvedValue({
      data: {
        userId: "staff-2",
        displayName: "別スタッフ",
        role: "staff",
        status: "active",
      },
    });

    await expect(
      executeStaffAttendanceAction(
        action,
        input,
        reauthenticate,
        subjectUserId,
      ),
    ).rejects.toMatchObject({
      code: "AUTH_SUBJECT_CHANGED",
      message: "認証主体が変更されたため、操作を中止しました。",
    });
    expect(action).toHaveBeenCalledOnce();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  test("action exception passes through and does not reauthenticate", async () => {
    const actionError = new Error("action failure");
    const action = vi.fn<Action>().mockRejectedValue(actionError);
    const reauthenticate = vi.fn<Reauthenticate>();
    await expect(
      executeStaffAttendanceAction(
        action,
        input,
        reauthenticate,
        subjectUserId,
      ),
    ).rejects.toBe(actionError);
    expect(reauthenticate).not.toHaveBeenCalled();
  });
});

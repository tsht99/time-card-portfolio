import { describe, expect, test, vi } from "vitest";
import {
  AdminClientError,
  clientErrorFromAction,
  clientErrorFromReadState,
  readAdminState,
  runAdminAction,
} from "./admin-action-client.ts";

describe("admin action client", () => {
  test("成功結果は再認証せず、operationを1回だけ実行する", async () => {
    const operation = vi.fn().mockResolvedValue({ success: true });
    const reauthenticate = vi.fn();

    await expect(runAdminAction(operation, reauthenticate)).resolves.toEqual({
      success: true,
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("actionのSESSION_EXPIREDだけ再認証後に1回再試行する", async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "期限切れ",
      })
      .mockResolvedValueOnce({ success: true });
    const reauthenticate = vi.fn().mockResolvedValue(undefined);

    await expect(runAdminAction(operation, reauthenticate)).resolves.toEqual({
      success: true,
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  test("readのmissingだけ再認証後に1回再試行する", async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({ status: "missing", message: "期限切れ" })
      .mockResolvedValueOnce({ status: "ready", data: ["summary"] });
    const reauthenticate = vi.fn().mockResolvedValue(undefined);

    await expect(readAdminState(operation, reauthenticate)).resolves.toEqual({
      status: "ready",
      data: ["summary"],
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  test("2回目も認証切れなら再帰せず、その結果を返す", async () => {
    const result = {
      success: false as const,
      code: "SESSION_EXPIRED" as const,
      message: "期限切れ",
    };
    const operation = vi.fn().mockResolvedValue(result);
    const reauthenticate = vi.fn().mockResolvedValue(undefined);

    await expect(runAdminAction(operation, reauthenticate)).resolves.toBe(
      result,
    );
    expect(operation).toHaveBeenCalledTimes(2);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  test("非認証エラーでは再認証せず、再認証失敗時はその値を伝播する", async () => {
    const nonAuthOperation = vi.fn().mockResolvedValue({
      success: false,
      code: "BUSINESS_ERROR",
      message: "業務エラー",
    });
    const reauthenticate = vi.fn();
    await expect(
      runAdminAction(nonAuthOperation, reauthenticate),
    ).resolves.toEqual({
      success: false,
      code: "BUSINESS_ERROR",
      message: "業務エラー",
    });
    expect(nonAuthOperation).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();

    const operation = vi.fn().mockResolvedValue({
      success: false,
      code: "SESSION_EXPIRED",
      message: "期限切れ",
    });
    const rejection = new AdminClientError(
      "再認証失敗",
      "ADMIN_ACCESS_REQUIRED",
      "authorization",
    );
    const failedReauthentication = vi.fn().mockRejectedValue(rejection);
    await expect(
      runAdminAction(operation, failedReauthentication),
    ).rejects.toBe(rejection);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("action/read failureを標準Client Errorへ分類する", () => {
    expect(
      clientErrorFromAction({
        success: false,
        code: "SESSION_EXPIRED",
        message: "期限切れのメッセージ",
      }),
    ).toMatchObject({
      message: "期限切れのメッセージ",
      code: "SESSION_EXPIRED",
      kind: "session",
    });
    expect(
      clientErrorFromReadState({ status: "missing", message: "見つからない" }),
    ).toMatchObject({ code: "SESSION_EXPIRED", kind: "session" });
    expect(
      clientErrorFromReadState({
        status: "unavailable",
        code: "ADMIN_ACCESS_REQUIRED",
        message: "権限なし",
      }),
    ).toMatchObject({ code: "ADMIN_ACCESS_REQUIRED", kind: "authorization" });
    expect(
      clientErrorFromReadState({ status: "unavailable", message: "権限なし" }),
    ).toMatchObject({ kind: "authorization" });
    expect(
      clientErrorFromAction({
        success: false,
        code: "ACTOR_NOT_ACTIVE",
        message: "利用停止",
      }),
    ).toMatchObject({ code: "ACTOR_NOT_ACTIVE", kind: "authorization" });
    expect(
      clientErrorFromAction({
        success: false,
        code: "BUSINESS_ERROR",
        message: "業務エラー",
      }),
    ).toBeInstanceOf(AdminClientError);
    expect(
      clientErrorFromAction({
        success: false,
        code: "BUSINESS_ERROR",
        message: "業務エラー",
      }).kind,
    ).toBe("generic");
  });
});

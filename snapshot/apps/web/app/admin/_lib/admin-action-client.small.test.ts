import { describe, expect, test, vi } from "vitest";
import {
  AdminClientError,
  clientErrorFromReadState,
  runAdminAction,
  throwForActionFailure,
} from "./admin-action-client.ts";

describe("admin action client", () => {
  test("native success data passes through and does not reauthenticate", async () => {
    const result = { data: "attendance-1" };
    const operation = vi.fn().mockResolvedValue(result);
    const reauthenticate = vi.fn();
    await expect(runAdminAction(operation, reauthenticate)).resolves.toBe(
      result,
    );
    expect(operation).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("SESSION_EXPIRED reauthenticates but never replays the mutation", async () => {
    const operation = vi.fn().mockResolvedValue({
      serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
    });
    const reauthenticate = vi.fn().mockResolvedValue(undefined);
    await expect(
      runAdminAction(operation, reauthenticate),
    ).rejects.toMatchObject({
      code: "MUTATION_NOT_PERFORMED_REAUTHENTICATED",
      kind: "session",
      message: expect.stringContaining("手動で再度実行"),
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  test("blocks mutations while server data freshness is pending", async () => {
    const operation = vi.fn();
    await expect(
      runAdminAction(operation, undefined, () => false),
    ).rejects.toMatchObject({
      code: "SERVER_DATA_REFRESH_PENDING",
      kind: "session",
    });
    expect(operation).not.toHaveBeenCalled();
  });

  test("native server errors pass through and do not retry unless session expired", async () => {
    const result = {
      serverError: { code: "BUSINESS_ERROR", message: "業務エラー" },
    };
    const operation = vi.fn().mockResolvedValue(result);
    const reauthenticate = vi.fn();
    await expect(runAdminAction(operation, reauthenticate)).resolves.toBe(
      result,
    );
    expect(operation).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  test("validation failures remain native and expired result is not retried", async () => {
    const validation = { validationErrors: { _errors: ["invalid"] } };
    const validationOperation = vi.fn().mockResolvedValue(validation);
    const reauthenticate = vi.fn().mockResolvedValue(undefined);
    await expect(
      runAdminAction(validationOperation, reauthenticate),
    ).resolves.toBe(validation);
    expect(validationOperation).toHaveBeenCalledOnce();
    expect(reauthenticate).not.toHaveBeenCalled();

    const operation = vi.fn().mockResolvedValue({
      serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
    });
    await expect(
      runAdminAction(operation, reauthenticate),
    ).rejects.toMatchObject({
      code: "MUTATION_NOT_PERFORMED_REAUTHENTICATED",
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  test("reauthentication failure surfaces unchanged and does not retry", async () => {
    const authError = new Error("LINE admin reauthentication failed");
    const operation = vi.fn().mockResolvedValue({
      serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
    });
    const reauthenticate = vi.fn().mockRejectedValue(authError);
    await expect(runAdminAction(operation, reauthenticate)).rejects.toBe(
      authError,
    );
    expect(operation).toHaveBeenCalledOnce();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  test("reauthentication to a different subject aborts the original admin operation", async () => {
    const subjectChanged = new AdminClientError(
      "認証主体が変更されたため、操作を中止しました。",
      "AUTH_SUBJECT_CHANGED",
      "authorization",
    );
    const operation = vi.fn().mockResolvedValue({
      serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
    });
    const reauthenticate = vi.fn().mockRejectedValue(subjectChanged);

    await expect(runAdminAction(operation, reauthenticate)).rejects.toBe(
      subjectChanged,
    );
    expect(operation).toHaveBeenCalledOnce();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  test("validation errors stay native and map to a local request error", () => {
    expect(() =>
      throwForActionFailure({ validationErrors: { _errors: ["invalid"] } }),
    ).toThrow("リクエスト形式が正しくありません。");
    expect(() =>
      throwForActionFailure({ serverError: { code: "X", message: "失敗" } }),
    ).toThrow("失敗");
  });

  test("native server errors and read states map to owned errors", () => {
    const actionFailure = () =>
      throwForActionFailure({
        serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
      });
    expect(actionFailure).toThrow();
    try {
      actionFailure();
    } catch (error) {
      expect(error).toMatchObject({
        message: "期限切れ",
        code: "SESSION_EXPIRED",
        kind: "session",
      });
    }
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
    expect(new AdminClientError("error")).toBeInstanceOf(Error);
  });
});

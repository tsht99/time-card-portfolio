"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { AdminAttendanceDetail } from "@repo/contracts";
import {
  correctAttendanceRequestSchema,
  createAdminAttendanceRequestSchema,
} from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { useRouter } from "next/navigation";
import {
  type SubmitEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { WorkPeriodChoice } from "@/app/_components/work-period-choice";
import { toTokyoDateTimeLocal } from "../../../../../../lib/tokyo-date-time";
import { correctAdminAttendanceAction } from "../../../../_actions/attendance-actions.ts";
import { useAuth } from "../../../../_components/auth-provider.tsx";
import { UserContextCard } from "../../../../_components/user-context-card.tsx";
import {
  AdminClientError,
  runAdminAction,
  throwForActionFailure,
} from "../../../../_lib/admin-action-client.ts";
import type { AdminUserListState } from "../../../../_lib/admin-user-management-types.ts";
import type { AdminAttendanceDetailState } from "../../../_lib/admin-attendance-types.ts";
import { canEditAttendanceTarget } from "../../../_lib/attendance-edit-access.ts";
import {
  datetimeLocalFormSchema,
  setContractFieldErrors,
  toTokyoDateTimeRequest,
} from "../../../_lib/attendance-form-utils.ts";
import { AttendanceCurrentSummary } from "../../_components/attendance-current-summary.tsx";

const correctionFormSchema = z
  .object({
    expectedVersion: correctAttendanceRequestSchema.shape.expectedVersion,
    workPeriod: correctAttendanceRequestSchema.shape.workPeriod.unwrap(),
    clockInAt: datetimeLocalFormSchema("出勤日時を入力してください。"),
    clockOutAt: z.string(),
    clockOutMode: z.enum(["required", "omitted"]),
  })
  .superRefine((value, context) => {
    if (value.clockOutMode === "required" && value.clockOutAt === "") {
      context.addIssue({
        code: "custom",
        path: ["clockOutAt"],
        message: "退勤日時を入力してください。",
      });
    } else if (
      value.clockOutAt !== "" &&
      !createAdminAttendanceRequestSchema.shape.clockOutAt.safeParse(
        toTokyoDateTimeRequest(value.clockOutAt),
      ).success
    ) {
      context.addIssue({
        code: "custom",
        path: ["clockOutAt"],
        message: "日時は有効なISO 8601 datetimeで指定してください。",
      });
    }
    if (
      value.clockInAt !== "" &&
      value.clockOutAt !== "" &&
      createAdminAttendanceRequestSchema.shape.clockInAt.safeParse(
        toTokyoDateTimeRequest(value.clockInAt),
      ).success &&
      createAdminAttendanceRequestSchema.shape.clockOutAt.safeParse(
        toTokyoDateTimeRequest(value.clockOutAt),
      ).success &&
      value.clockOutAt < value.clockInAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["clockOutAt"],
        message: "退勤日時は出勤日時以降を指定してください。",
      });
    }
  });

type CorrectionForm = z.infer<typeof correctionFormSchema>;

function correctionFormFor(detail: AdminAttendanceDetail): CorrectionForm {
  return {
    expectedVersion: detail.eventVersion,
    workPeriod: detail.workPeriod,
    clockInAt: toTokyoDateTimeLocal(detail.clockInAt),
    clockOutAt: detail.clockOutAt
      ? toTokyoDateTimeLocal(detail.clockOutAt)
      : "",
    clockOutMode: detail.clockOutAt === null ? "omitted" : "required",
  };
}

function getActionErrorMessage(error: AdminClientError | null) {
  if (!error) return null;
  if (error.code === "ATTENDANCE_VERSION_CONFLICT") {
    return "他の操作により勤怠が更新されました。入力内容を保持したまま最新状態を確認し、もう一度保存してください。";
  }
  return error.message;
}

function CorrectionForm({
  detail,
  detailHref,
}: {
  detail: AdminAttendanceDetail;
  detailHref: string;
}) {
  const { reauthenticate, canMutate } = useAuth();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<AdminClientError | null>(null);
  const submitting = useRef(false);
  const correctionForm = useForm<CorrectionForm>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: correctionFormFor(detail),
  });
  useEffect(() => {
    correctionForm.setValue("expectedVersion", detail.eventVersion);
    correctionForm.setValue(
      "clockOutMode",
      detail.clockOutAt === null ? "omitted" : "required",
    );
  }, [detail.clockOutAt, detail.eventVersion, correctionForm]);

  const submit = (form: CorrectionForm) => {
    const request = {
      expectedVersion: form.expectedVersion,
      workPeriod: form.workPeriod,
      clockInAt: toTokyoDateTimeRequest(form.clockInAt),
      ...(form.clockOutAt !== ""
        ? { clockOutAt: toTokyoDateTimeRequest(form.clockOutAt) }
        : {}),
    };
    const parsedRequest = correctAttendanceRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      setContractFieldErrors(
        parsedRequest.error.issues,
        correctionForm.setError,
        ["workPeriod", "clockInAt", "clockOutAt"],
      );
      submitting.current = false;
      return;
    }
    setActionError(null);
    startTransition(async () => {
      try {
        const result = await runAdminAction(
          () =>
            correctAdminAttendanceAction({
              attendanceId: detail.attendanceId,
              changes: parsedRequest.data,
            }),
          reauthenticate,
          canMutate,
        );
        throwForActionFailure(result);
        router.replace(detailHref);
      } catch (error) {
        const nextError =
          error instanceof AdminClientError
            ? error
            : new AdminClientError("勤怠の訂正に失敗しました。");
        setActionError(nextError);
        if (nextError.code === "ATTENDANCE_VERSION_CONFLICT") router.refresh();
      } finally {
        submitting.current = false;
      }
    });
  };

  async function submitForm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setActionError(null);
    await correctionForm.handleSubmit(submit, () => {
      submitting.current = false;
    })(event);
  }

  const actionErrorMessage = getActionErrorMessage(actionError);

  return (
    <form className="mt-6" aria-label="勤怠訂正フォーム" onSubmit={submitForm}>
      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-col gap-1 text-sm font-medium">
          <Controller
            control={correctionForm.control}
            name="workPeriod"
            render={({ field }) => (
              <WorkPeriodChoice
                value={field.value}
                onValueChange={field.onChange}
                name={field.name}
                legend="勤務区分"
                disabled={isPending}
                onBlur={field.onBlur}
                inputRef={field.ref}
                aria-invalid={
                  correctionForm.formState.errors.workPeriod ? true : undefined
                }
                aria-describedby={
                  correctionForm.formState.errors.workPeriod
                    ? "correction-work-period-error"
                    : undefined
                }
              />
            )}
          />
          {correctionForm.formState.errors.workPeriod?.message && (
            <p
              id="correction-work-period-error"
              className="text-sm font-normal text-red-700"
              role="alert"
            >
              {correctionForm.formState.errors.workPeriod.message}
            </p>
          )}
        </div>
        <label
          htmlFor="correction-clock-in"
          className="flex flex-col gap-1 text-sm font-medium"
        >
          出勤日時
          <Input
            id="correction-clock-in"
            {...correctionForm.register("clockInAt")}
            disabled={isPending}
            aria-invalid={
              correctionForm.formState.errors.clockInAt ? true : undefined
            }
            aria-describedby={
              correctionForm.formState.errors.clockInAt
                ? "correction-clock-in-error"
                : undefined
            }
            type="datetime-local"
            step={60}
            className="bg-white font-normal"
          />
          {correctionForm.formState.errors.clockInAt?.message && (
            <p
              id="correction-clock-in-error"
              className="text-sm font-normal text-red-700"
              role="alert"
            >
              {correctionForm.formState.errors.clockInAt.message}
            </p>
          )}
        </label>
        <label
          htmlFor="correction-clock-out"
          className="flex flex-col gap-1 text-sm font-medium"
        >
          退勤日時
          <Input
            id="correction-clock-out"
            {...correctionForm.register("clockOutAt")}
            disabled={isPending}
            aria-label="訂正退勤日時"
            aria-invalid={
              correctionForm.formState.errors.clockOutAt ? true : undefined
            }
            aria-describedby={
              correctionForm.formState.errors.clockOutAt
                ? "correction-clock-out-error"
                : undefined
            }
            type="datetime-local"
            step={60}
            className="bg-white font-normal"
          />
          {correctionForm.formState.errors.clockOutAt?.message && (
            <p
              id="correction-clock-out-error"
              className="text-sm font-normal text-red-700"
              role="alert"
            >
              {correctionForm.formState.errors.clockOutAt.message}
            </p>
          )}
        </label>
      </div>
      {actionErrorMessage && (
        <Alert className="mt-3" variant="destructive">
          <AlertDescription>
            勤怠の訂正に失敗しました：{actionErrorMessage}
          </AlertDescription>
        </Alert>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => router.replace(detailHref)}
        >
          キャンセル
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "保存中" : "保存"}
        </Button>
      </div>
    </form>
  );
}

export function AttendanceCorrection({
  initialDetail,
  initialUsers,
  detailHref,
}: {
  initialDetail: AdminAttendanceDetailState;
  initialUsers: AdminUserListState;
  detailHref: string;
}) {
  const { authState } = useAuth();
  const canEdit =
    authState.status === "ready" &&
    initialDetail.status === "ready" &&
    canEditAttendanceTarget(
      initialUsers,
      authState.user.userId,
      initialDetail.data.userId,
    );
  return (
    <main className="w-full min-w-0 text-zinc-950">
      <section className="w-full min-w-0 p-4">
        {authState.status === "checking" && <p>{authState.message}</p>}
        {(authState.status === "error" ||
          authState.status === "unavailable") && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{authState.message}</AlertDescription>
          </Alert>
        )}
        {authState.status === "ready" && (
          <>
            {initialDetail.status === "missing" && (
              <p className="mt-6">勤怠が見つかりません。</p>
            )}
            {(initialDetail.status === "error" ||
              initialDetail.status === "unavailable") && (
              <Alert variant="destructive" className="mt-6">
                <AlertDescription>{initialDetail.message}</AlertDescription>
              </Alert>
            )}
            {initialDetail.status === "ready" && (
              <>
                <UserContextCard displayName={initialDetail.data.displayName} />
                <AttendanceCurrentSummary
                  detail={initialDetail.data}
                  heading="現在登録されている勤怠"
                  headingId="attendance-correction-current"
                />
                {initialDetail.data.status === "cancelled" ? (
                  <p className="mt-4 text-sm text-zinc-700">
                    取消済みの勤怠は訂正できません。
                  </p>
                ) : !canEdit ? (
                  <p className="mt-4 text-sm text-zinc-700">
                    この勤怠は閲覧のみ可能です。
                  </p>
                ) : (
                  <CorrectionForm
                    detail={initialDetail.data}
                    detailHref={detailHref}
                  />
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

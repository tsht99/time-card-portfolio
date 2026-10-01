"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { CreateAdminAttendanceRequest } from "@repo/contracts";
import { createAdminAttendanceRequestSchema } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { WorkPeriodIcon } from "@/app/_components/work-period-icon";
import type { AdminUsersState } from "../../../../lib/admin-user-management-types";
import { createAdminAttendanceAction } from "../../_actions/attendance-actions.ts";
import { useAuth } from "../../_components/auth-provider.tsx";
import {
  clientErrorFromAction,
  runAdminAction,
} from "../../_lib/admin-action-client.ts";
import { canEditAttendanceTarget } from "../attendance-edit-access";
import {
  datetimeLocalFormSchema,
  setContractFieldErrors,
  toTokyoDateTimeRequest,
} from "../attendance-form-utils";
import { getAttendanceDetailHref } from "../attendance-navigation";

const creationFormSchema = z
  .object({
    userId: z.string().min(1, "対象者を選択してください。"),
    workPeriod: z
      .union([
        z.literal(""),
        createAdminAttendanceRequestSchema.shape.workPeriod,
      ])
      .refine((value) => value !== "", {
        message: "勤務区分を選択してください。",
      }),
    clockInAt: datetimeLocalFormSchema("出勤日時を入力してください。"),
    clockOutAt: datetimeLocalFormSchema("退勤日時を入力してください。"),
  })
  .superRefine((value, context) => {
    if (
      value.clockInAt !== "" &&
      value.clockOutAt !== "" &&
      createAdminAttendanceRequestSchema.shape.clockInAt.safeParse(
        toTokyoDateTimeRequest(value.clockInAt),
      ).success &&
      createAdminAttendanceRequestSchema.shape.clockOutAt.safeParse(
        toTokyoDateTimeRequest(value.clockOutAt),
      ).success &&
      value.clockOutAt <= value.clockInAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["clockOutAt"],
        message: "退勤日時は出勤日時より後にしてください。",
      });
    }
  });

type CreationForm = z.input<typeof creationFormSchema>;
type CreationFormOutput = z.output<typeof creationFormSchema>;

const initialCreationForm: CreationForm = {
  userId: "",
  workPeriod: "",
  clockInAt: "",
  clockOutAt: "",
};

export function AttendanceCreation({
  initialUsers,
  canonicalQuery,
}: {
  initialUsers: AdminUsersState;
  canonicalQuery: string;
}) {
  const { authState, reauthenticate } = useAuth();
  const router = useRouter();
  const creationForm = useForm<CreationForm, unknown, CreationFormOutput>({
    resolver: zodResolver(creationFormSchema),
    defaultValues: initialCreationForm,
  });
  const creationMutation = useMutation({
    mutationFn: (body: CreateAdminAttendanceRequest) =>
      runAdminAction(
        () => createAdminAttendanceAction(body),
        reauthenticate,
      ).then((result) => {
        if (!result.success) throw clientErrorFromAction(result);
        return result;
      }),
    onSuccess: (result) => {
      if (!result.attendanceId) {
        throw new Error("作成された勤怠IDを取得できませんでした。");
      }
      router.replace(
        getAttendanceDetailHref(result.attendanceId, canonicalQuery),
      );
    },
  });

  const users = initialUsers.status === "ready" ? initialUsers.data : [];
  const creationCandidates = users.filter(
    (user) =>
      (user.status === "active" || user.status === "inactive") &&
      authState.status === "ready" &&
      canEditAttendanceTarget(initialUsers, authState.user.userId, user.userId),
  );
  const submitCreation = creationForm.handleSubmit((form) => {
    if (
      initialUsers.status !== "ready" ||
      authState.status !== "ready" ||
      !creationCandidates.some((user) => user.userId === form.userId)
    ) {
      return;
    }
    const request = {
      userId: form.userId,
      workPeriod: form.workPeriod,
      clockInAt: toTokyoDateTimeRequest(form.clockInAt),
      clockOutAt: toTokyoDateTimeRequest(form.clockOutAt),
    };
    const parsedRequest = createAdminAttendanceRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      setContractFieldErrors(
        parsedRequest.error.issues,
        creationForm.setError,
        ["userId", "workPeriod", "clockInAt", "clockOutAt"],
      );
      return;
    }
    creationMutation.mutate(parsedRequest.data);
  });

  function submitCreationForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    creationMutation.reset();
    void submitCreation(event);
  }

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
            {initialUsers.status !== "ready" && (
              <Alert
                variant={
                  initialUsers.status === "missing" ? "warning" : "destructive"
                }
                className="mt-4"
              >
                <AlertDescription>
                  対象者候補を取得できないため、勤怠を新規作成できません。
                  {initialUsers.message}
                </AlertDescription>
              </Alert>
            )}
            {initialUsers.status === "ready" &&
              creationCandidates.length === 0 && (
                <p className="mt-4 text-sm text-zinc-700">
                  新規作成できる対象者がいません。
                </p>
              )}
            <form
              onSubmit={submitCreationForm}
              aria-label="勤怠新規作成フォーム"
              className="mt-6 grid grid-cols-1 gap-4"
            >
              <div className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                対象者
                <Controller
                  control={creationForm.control}
                  name="userId"
                  render={({ field }) => (
                    <Select
                      value={field.value === "" ? null : field.value}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      disabled={initialUsers.status !== "ready"}
                    >
                      <SelectTrigger
                        ref={field.ref}
                        onBlur={field.onBlur}
                        id="creation-user-id"
                        aria-label="作成対象者"
                        aria-invalid={
                          creationForm.formState.errors.userId
                            ? true
                            : undefined
                        }
                        aria-describedby={
                          creationForm.formState.errors.userId
                            ? "creation-user-id-error"
                            : undefined
                        }
                        className="bg-white font-normal"
                      >
                        <SelectValue>
                          {(value: string | null) =>
                            value === null
                              ? "対象者を選択"
                              : (creationCandidates.find(
                                  (user) => user.userId === value,
                                )?.displayName ?? "名前未設定")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>対象者を選択</SelectItem>
                        {creationCandidates.map((user) => (
                          <SelectItem key={user.userId} value={user.userId}>
                            {user.displayName ?? "名前未設定"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {creationForm.formState.errors.userId?.message && (
                  <p
                    id="creation-user-id-error"
                    className="text-sm font-normal text-red-700"
                    role="alert"
                  >
                    {creationForm.formState.errors.userId.message}
                  </p>
                )}
              </div>
              <Controller
                control={creationForm.control}
                name="workPeriod"
                render={({ field }) => (
                  <fieldset
                    className="flex min-w-0 flex-col gap-1 text-sm font-medium"
                    aria-describedby={
                      creationForm.formState.errors.workPeriod
                        ? "creation-work-period-error"
                        : undefined
                    }
                    aria-invalid={
                      creationForm.formState.errors.workPeriod
                        ? true
                        : undefined
                    }
                  >
                    <legend>勤務区分</legend>
                    <div
                      id="creation-work-period"
                      className="grid min-w-0 grid-cols-2 gap-2"
                      role="radiogroup"
                      aria-label="作成勤務区分"
                    >
                      {(
                        [
                          {
                            value: "day" as const,
                            label: "昼",
                            selectedClass:
                              "border-2 border-amber-500 bg-amber-50 text-amber-800",
                          },
                          {
                            value: "night" as const,
                            label: "夜",
                            selectedClass:
                              "border-2 border-indigo-500 bg-indigo-50 text-indigo-700",
                          },
                        ] as const
                      ).map(({ value, label, selectedClass }) => {
                        const selected = field.value === value;
                        return (
                          <label
                            key={value}
                            className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium outline-none transition-colors focus-within:ring-2 focus-within:ring-zinc-500 focus-within:ring-offset-2 ${selected ? selectedClass : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}
                          >
                            <input
                              ref={field.ref}
                              type="radio"
                              name={field.name}
                              value={value}
                              checked={selected}
                              onChange={() => {
                                field.onChange(value);
                                creationForm.clearErrors("workPeriod");
                              }}
                              onBlur={field.onBlur}
                              className="sr-only"
                            />
                            <WorkPeriodIcon workPeriod={value} />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              />
              {creationForm.formState.errors.workPeriod?.message && (
                <p
                  id="creation-work-period-error"
                  className="text-sm font-normal text-red-700"
                  role="alert"
                >
                  {creationForm.formState.errors.workPeriod.message}
                </p>
              )}
              <label
                htmlFor="creation-clock-in"
                className="flex min-w-0 flex-col gap-1 text-sm font-medium"
              >
                出勤日時
                <Input
                  id="creation-clock-in"
                  {...creationForm.register("clockInAt")}
                  aria-label="作成出勤日時"
                  aria-invalid={
                    creationForm.formState.errors.clockInAt ? true : undefined
                  }
                  aria-describedby={
                    creationForm.formState.errors.clockInAt
                      ? "creation-clock-in-error"
                      : undefined
                  }
                  type="datetime-local"
                  step={60}
                  className="bg-white font-normal"
                />
                {creationForm.formState.errors.clockInAt?.message && (
                  <p
                    id="creation-clock-in-error"
                    className="text-sm font-normal text-red-700"
                    role="alert"
                  >
                    {creationForm.formState.errors.clockInAt.message}
                  </p>
                )}
              </label>
              <label
                htmlFor="creation-clock-out"
                className="flex min-w-0 flex-col gap-1 text-sm font-medium"
              >
                退勤日時
                <Input
                  id="creation-clock-out"
                  {...creationForm.register("clockOutAt")}
                  aria-label="作成退勤日時"
                  aria-invalid={
                    creationForm.formState.errors.clockOutAt ? true : undefined
                  }
                  aria-describedby={
                    creationForm.formState.errors.clockOutAt
                      ? "creation-clock-out-error"
                      : undefined
                  }
                  type="datetime-local"
                  step={60}
                  className="bg-white font-normal"
                />
                {creationForm.formState.errors.clockOutAt?.message && (
                  <p
                    id="creation-clock-out-error"
                    className="text-sm font-normal text-red-700"
                    role="alert"
                  >
                    {creationForm.formState.errors.clockOutAt.message}
                  </p>
                )}
              </label>
              {creationMutation.error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {creationMutation.error.message}
                  </AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                disabled={
                  creationMutation.isPending ||
                  initialUsers.status !== "ready" ||
                  creationCandidates.length === 0
                }
                className="w-full"
              >
                {creationMutation.isPending ? "作成中" : "作成"}
              </Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

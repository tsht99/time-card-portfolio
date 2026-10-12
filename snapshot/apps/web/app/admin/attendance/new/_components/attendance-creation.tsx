"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createAdminAttendanceRequestSchema } from "@repo/contracts";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createAdminAttendanceAction } from "../../../_actions/attendance-actions.ts";
import { useAuth } from "../../../_components/auth-provider.tsx";
import {
  AdminClientError,
  runAdminAction,
  throwForActionFailure,
} from "../../../_lib/admin-action-client.ts";
import type { AdminUserListState } from "../../../_lib/admin-user-management-types.ts";
import { canEditAttendanceTarget } from "../../_lib/attendance-edit-access.ts";
import {
  datetimeLocalFormSchema,
  setContractFieldErrors,
  toTokyoDateTimeRequest,
} from "../../_lib/attendance-form-utils.ts";
import { getAttendanceDetailHref } from "../../_lib/attendance-navigation.ts";
import { AttendanceCreationView } from "./attendance-creation-view.tsx";

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
      value.clockOutAt < value.clockInAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["clockOutAt"],
        message: "退勤日時は出勤日時より前にできません。",
      });
    }
  });

export type CreationForm = z.input<typeof creationFormSchema>;
export type CreationFormOutput = z.output<typeof creationFormSchema>;

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
  initialUsers: AdminUserListState;
  canonicalQuery: string;
}) {
  const { authState, reauthenticate, canMutate } = useAuth();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState<AdminClientError | null>(
    null,
  );
  const submitting = useRef(false);
  const creationForm = useForm<CreationForm, unknown, CreationFormOutput>({
    resolver: zodResolver(creationFormSchema),
    defaultValues: initialCreationForm,
  });

  const users = initialUsers.status === "ready" ? initialUsers.data : [];
  const creationCandidates = users.filter(
    (user) =>
      (user.status === "active" || user.status === "inactive") &&
      authState.status === "ready" &&
      canEditAttendanceTarget(initialUsers, authState.user.userId, user.userId),
  );
  const submitCreation = (form: CreationFormOutput) => {
    if (
      initialUsers.status !== "ready" ||
      authState.status !== "ready" ||
      !creationCandidates.some((user) => user.userId === form.userId)
    ) {
      submitting.current = false;
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
      submitting.current = false;
      return;
    }
    setMutationError(null);
    startTransition(async () => {
      try {
        const result = await runAdminAction(
          () => createAdminAttendanceAction(parsedRequest.data),
          reauthenticate,
          canMutate,
        );
        throwForActionFailure(result);
        if (!result.data)
          throw new Error("作成された勤怠IDを取得できませんでした。");
        router.replace(getAttendanceDetailHref(result.data, canonicalQuery));
      } catch (error) {
        setMutationError(
          error instanceof AdminClientError
            ? error
            : new AdminClientError("勤怠を作成できませんでした。"),
        );
      } finally {
        submitting.current = false;
      }
    });
  };

  async function submitCreationForm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setMutationError(null);
    await creationForm.handleSubmit(submitCreation, () => {
      submitting.current = false;
    })(event);
  }

  return (
    <AttendanceCreationView
      authState={authState}
      initialUsers={initialUsers}
      creationCandidates={creationCandidates}
      creationForm={creationForm}
      isPending={isPending}
      mutationError={mutationError}
      onSubmit={submitCreationForm}
    />
  );
}

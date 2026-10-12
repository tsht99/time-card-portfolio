"use client";

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
import type { SubmitEvent } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { WorkPeriodChoice } from "@/app/_components/work-period-choice";
import type { AdminUserListState } from "../../../_lib/admin-user-management-types.ts";
import type {
  CreationForm,
  CreationFormOutput,
} from "./attendance-creation.tsx";

type Candidate = Extract<
  AdminUserListState,
  { status: "ready" }
>["data"][number];
type AuthViewState =
  | { status: "checking" | "error" | "unavailable"; message: string }
  | { status: "ready"; user: { userId: string } };

export function AttendanceCreationView({
  authState,
  initialUsers,
  creationCandidates,
  creationForm,
  isPending,
  mutationError,
  onSubmit,
}: {
  authState: AuthViewState;
  initialUsers: AdminUserListState;
  creationCandidates: Candidate[];
  creationForm: UseFormReturn<CreationForm, unknown, CreationFormOutput>;
  isPending: boolean;
  mutationError: Error | null;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
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
              onSubmit={onSubmit}
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
                      disabled={initialUsers.status !== "ready" || isPending}
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
                  <WorkPeriodChoice
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      creationForm.clearErrors("workPeriod");
                    }}
                    name={field.name}
                    legend="勤務区分"
                    disabled={isPending}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    aria-invalid={
                      creationForm.formState.errors.workPeriod
                        ? true
                        : undefined
                    }
                    aria-describedby={
                      creationForm.formState.errors.workPeriod
                        ? "creation-work-period-error"
                        : undefined
                    }
                  />
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
                  disabled={isPending}
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
                  disabled={isPending}
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
              {mutationError && (
                <Alert variant="destructive">
                  <AlertDescription>{mutationError.message}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                disabled={
                  isPending ||
                  initialUsers.status !== "ready" ||
                  creationCandidates.length === 0
                }
                className="w-full"
              >
                {isPending ? "作成中" : "作成"}
              </Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

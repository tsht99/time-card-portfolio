"use client";

import type { AuthStatus } from "../_hooks/use-staff-auth.ts";
import { StaffScreenFrame } from "./staff-screen-frame.tsx";

export const STAFF_AUTH_CHECKING_MESSAGE = "ログイン状態を確認しています。";

export function StaffAuthStatus({
  active,
  status,
  message,
}: {
  active: "clock" | "history";
  status: Exclude<AuthStatus, "ready">;
  message: string;
}) {
  const isChecking = status === "checking" || status === "missing";
  const isPending = status === "pending";
  const isInactive = status === "inactive";
  const title = isChecking
    ? "認証を確認中"
    : isPending
      ? "利用承認待ち"
      : isInactive
        ? "利用停止中"
        : "認証を確認できません";
  const description = isChecking ? STAFF_AUTH_CHECKING_MESSAGE : message;
  const className = isChecking
    ? "border-zinc-200 bg-white"
    : isPending
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : "border-red-200 bg-red-50 text-red-900";

  return (
    <main className="flex min-h-dvh flex-col px-0 py-0 text-zinc-950">
      <StaffScreenFrame active={active}>
        <section className={`rounded-md border p-4 ${className}`}>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-3">{description}</p>
          {isPending && (
            <p className="mt-2 text-sm text-amber-900">
              管理者に承認されるまで勤怠機能は利用できません。
            </p>
          )}
        </section>
      </StaffScreenFrame>
    </main>
  );
}

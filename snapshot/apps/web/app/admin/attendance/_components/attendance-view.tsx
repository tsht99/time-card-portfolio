"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import type { AdminUserListState } from "../../_lib/admin-user-management-types.ts";
import type { AttendanceFilters } from "../_lib/admin-attendance-filters";
import { serializeAttendanceFilters } from "../_lib/admin-attendance-filters";
import type { AdminAttendanceViewState } from "../_lib/admin-attendance-types.ts";
import { AttendanceList } from "./attendance-list.tsx";
import { AttendanceSearchForm } from "./attendance-search-form.tsx";

type AuthState =
  | {
      status: "checking" | "error" | "unavailable";
      message: string;
    }
  | {
      status: "ready";
      message?: string;
    };

export function AttendanceView({
  authState,
  appliedFilters,
  initialAttendance,
  initialUsers,
}: {
  authState: AuthState;
  appliedFilters: AttendanceFilters;
  initialAttendance: AdminAttendanceViewState;
  initialUsers: AdminUserListState;
}) {
  const listReadStates = [initialAttendance];
  const showAttendanceList = listReadStates.every(
    (state) => state.status === "ready",
  );
  const visibleAttendance =
    initialAttendance.status === "ready"
      ? appliedFilters.status === "cancelled"
        ? []
        : initialAttendance.data.attendance
      : [];
  const visibleCancelledAttendance =
    initialAttendance.status === "ready"
      ? appliedFilters.status === "" || appliedFilters.status === "cancelled"
        ? initialAttendance.data.cancelledAttendance
        : []
      : [];
  const canonicalQuery = serializeAttendanceFilters(appliedFilters).toString();

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
        <AttendanceSearchForm
          appliedFilters={appliedFilters}
          initialUsers={initialUsers}
          isVisible={authState.status === "ready"}
        />
        {authState.status === "ready" && initialUsers.status !== "ready" && (
          <Alert
            variant={
              initialUsers.status === "missing" ? "warning" : "destructive"
            }
            className="mt-3"
          >
            <AlertDescription>{initialUsers.message}</AlertDescription>
          </Alert>
        )}
        {authState.status === "ready" && (
          <>
            {showAttendanceList && (
              <AttendanceList
                attendance={visibleAttendance}
                cancelledAttendance={visibleCancelledAttendance}
                canonicalQuery={canonicalQuery}
              />
            )}
            {!showAttendanceList && (
              <section className="mt-6" aria-label="勤怠一覧">
                <Alert className="mt-3" variant="destructive">
                  <AlertDescription className="space-y-1">
                    {Array.from(
                      new Set(
                        listReadStates
                          .filter((state) => state.status !== "ready")
                          .map((state) => state.message),
                      ),
                    ).map((message) => (
                      <p key={message}>{message}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}

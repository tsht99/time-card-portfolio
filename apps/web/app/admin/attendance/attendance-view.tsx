"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import type { AttendanceFilters } from "../../../lib/admin-attendance-filters";
import { serializeAttendanceFilters } from "../../../lib/admin-attendance-filters";
import type {
  AdminAttendanceListState,
  AdminCancelledAttendanceListState,
} from "../../../lib/admin-attendance-types";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { AttendanceList } from "./attendance-list";
import { AttendanceSearchForm } from "./attendance-search-form";

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
  initialCancelledAttendance,
  initialUsers,
}: {
  authState: AuthState;
  appliedFilters: AttendanceFilters;
  initialAttendance: AdminAttendanceListState;
  initialCancelledAttendance: AdminCancelledAttendanceListState;
  initialUsers: AdminUsersState;
}) {
  const listReadStates =
    appliedFilters.status === ""
      ? [initialAttendance, initialCancelledAttendance]
      : appliedFilters.status === "cancelled"
        ? [initialCancelledAttendance]
        : [initialAttendance];
  const showAttendanceList = listReadStates.every(
    (state) => state.status === "ready",
  );
  const visibleAttendance =
    appliedFilters.status === "cancelled"
      ? []
      : initialAttendance.status === "ready"
        ? initialAttendance.data
        : [];
  const visibleCancelledAttendance =
    appliedFilters.status === "" || appliedFilters.status === "cancelled"
      ? initialCancelledAttendance.status === "ready"
        ? initialCancelledAttendance.data
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

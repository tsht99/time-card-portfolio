"use client";

import type { AttendanceFilters } from "../../../lib/admin-attendance-filters";
import type {
  AdminAttendanceListState,
  AdminCancelledAttendanceListState,
} from "../../../lib/admin-attendance-types";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { useAuth } from "../_components/auth-provider.tsx";
import { AttendanceView } from "./attendance-view";

export function AttendanceClient({
  appliedFilters,
  initialAttendance,
  initialCancelledAttendance,
  initialUsers,
}: {
  appliedFilters: AttendanceFilters;
  initialAttendance: AdminAttendanceListState;
  initialCancelledAttendance: AdminCancelledAttendanceListState;
  initialUsers: AdminUsersState;
}) {
  const { authState } = useAuth();
  return (
    <AttendanceView
      authState={authState}
      appliedFilters={appliedFilters}
      initialAttendance={initialAttendance}
      initialCancelledAttendance={initialCancelledAttendance}
      initialUsers={initialUsers}
    />
  );
}

"use client";

import { useAuth } from "../../_components/auth-provider.tsx";
import type { AdminUserListState } from "../../_lib/admin-user-management-types.ts";
import type { AttendanceFilters } from "../_lib/admin-attendance-filters";
import type { AdminAttendanceViewState } from "../_lib/admin-attendance-types.ts";
import { AttendanceView } from "./attendance-view.tsx";

export function AttendanceClient({
  appliedFilters,
  initialAttendance,
  initialUsers,
}: {
  appliedFilters: AttendanceFilters;
  initialAttendance: AdminAttendanceViewState;
  initialUsers: AdminUserListState;
}) {
  const { authState } = useAuth();
  return (
    <AttendanceView
      authState={authState}
      appliedFilters={appliedFilters}
      initialAttendance={initialAttendance}
      initialUsers={initialUsers}
    />
  );
}

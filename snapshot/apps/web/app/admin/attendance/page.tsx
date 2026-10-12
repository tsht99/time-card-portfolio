import { redirect } from "next/navigation";
import { createLoader } from "nuqs/server";
import { getServerReferenceTime } from "../../../lib/server/reference-time";
import { loadAdminUsers } from "../_lib/admin-user-management.ts";
import { AttendanceClient } from "./_components/attendance-client.tsx";
import {
  loadAdminAttendance,
  mapAdminAttendanceRows,
} from "./_lib/admin-attendance";
import {
  type AttendanceFilters,
  adminAttendanceFilterParsers,
  getCanonicalAttendanceFilterQuery,
  getDefaultAttendanceFilters,
  type ParsedAttendanceFilterQuery,
} from "./_lib/admin-attendance-filters";
import type { AdminAttendanceViewState } from "./_lib/admin-attendance-types.ts";

type SearchParams = Record<string, string | string[] | undefined>;
const loadAttendanceFilterQuery = createLoader(adminAttendanceFilterParsers);

function toSearchString(searchParams: SearchParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value))
      for (const item of value) query.append(key, item);
  }
  return query.toString();
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const serverReferenceTime = getServerReferenceTime();
  const rawSearchParams: SearchParams = await (searchParams ??
    Promise.resolve({}));
  const rawSearchString = toSearchString(rawSearchParams);
  const parsedQuery: ParsedAttendanceFilterQuery =
    loadAttendanceFilterQuery(rawSearchParams);
  const canonicalSearchString = getCanonicalAttendanceFilterQuery(
    rawSearchParams,
    parsedQuery,
  );
  const appliedFilters: AttendanceFilters =
    canonicalSearchString !== null &&
    parsedQuery.from !== null &&
    parsedQuery.to !== null
      ? {
          startAttendanceDateInclusive: parsedQuery.from,
          endAttendanceDateInclusive: parsedQuery.to,
          userId: parsedQuery.userId ?? "",
          workPeriod: parsedQuery.workPeriod ?? "",
          status: parsedQuery.status ?? "",
        }
      : getDefaultAttendanceFilters(serverReferenceTime);
  if (rawSearchString !== "") {
    if (rawSearchString !== (canonicalSearchString ?? "")) {
      redirect(
        canonicalSearchString
          ? `/admin/attendance?${canonicalSearchString}`
          : "/admin/attendance",
      );
    }
  }
  const [attendanceRead, initialUsers] = await Promise.all([
    loadAdminAttendance(appliedFilters),
    loadAdminUsers(),
  ]);
  const initialAttendance: AdminAttendanceViewState =
    attendanceRead.status === "ready"
      ? {
          status: "ready",
          data: mapAdminAttendanceRows(
            attendanceRead.data,
            initialUsers.status === "ready" ? initialUsers.data : [],
          ),
        }
      : attendanceRead;

  return (
    <AttendanceClient
      key={rawSearchString}
      appliedFilters={appliedFilters}
      initialAttendance={initialAttendance}
      initialUsers={initialUsers}
    />
  );
}

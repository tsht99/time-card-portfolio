import { redirect } from "next/navigation";
import {
  isValidAttendanceDateRange,
  parseAttendanceFilters,
  serializeAttendanceFilters,
} from "../../../lib/admin-attendance-filters";
import {
  loadAdminAttendanceList,
  loadAdminCancelledAttendanceList,
} from "../../../lib/server/admin-attendance";
import { loadAdminUsers } from "../../../lib/server/admin-user-management";
import { getServerReferenceTime } from "../../../lib/server/reference-time";
import { AttendanceClient } from "./attendance-client";

type SearchParams = Record<string, string | string[] | undefined>;

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
  const rawSearchString = toSearchString(
    await (searchParams ?? Promise.resolve({})),
  );
  const appliedFilters = parseAttendanceFilters(
    new URLSearchParams(rawSearchString),
    serverReferenceTime,
  );
  if (rawSearchString !== "") {
    const params = new URLSearchParams(rawSearchString);
    const canonicalSearchString =
      params.has("from") &&
      params.has("to") &&
      isValidAttendanceDateRange(
        params.get("from") ?? "",
        params.get("to") ?? "",
      )
        ? serializeAttendanceFilters(appliedFilters).toString()
        : "";
    if (rawSearchString !== canonicalSearchString) {
      redirect(
        canonicalSearchString
          ? `/admin/attendance?${canonicalSearchString}`
          : "/admin/attendance",
      );
    }
  }
  const [initialAttendance, initialCancelledAttendance, initialUsers] =
    await Promise.all([
      loadAdminAttendanceList(appliedFilters),
      loadAdminCancelledAttendanceList(appliedFilters),
      loadAdminUsers(),
    ]);

  return (
    <AttendanceClient
      key={rawSearchString}
      appliedFilters={appliedFilters}
      initialAttendance={initialAttendance}
      initialCancelledAttendance={initialCancelledAttendance}
      initialUsers={initialUsers}
    />
  );
}

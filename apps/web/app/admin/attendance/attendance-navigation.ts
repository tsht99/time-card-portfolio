import {
  isValidAttendanceDateRange,
  parseAttendanceFilters,
  serializeAttendanceFilters,
} from "../../../lib/admin-attendance-filters";

export type AttendanceNavigationSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type AttendanceNavigationLinks = {
  detailHref: string;
  correctionHref: string;
};

export type AttendanceCreationNavigationLinks = {
  canonicalQuery: string;
  creationHref: string;
};

function getCanonicalListQuery(
  searchParams: AttendanceNavigationSearchParams,
): string {
  const from = searchParams.from;
  const to = searchParams.to;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !isValidAttendanceDateRange(from, to)
  ) {
    return "";
  }

  const filterParams = new URLSearchParams({ from, to });
  for (const key of ["userId", "workPeriod", "status"] as const) {
    const value = searchParams[key];
    if (typeof value === "string") filterParams.set(key, value);
  }
  return serializeAttendanceFilters(
    parseAttendanceFilters(filterParams),
  ).toString();
}

export function getAttendanceNavigationLinks(
  attendanceId: string,
  searchParams: AttendanceNavigationSearchParams,
): AttendanceNavigationLinks {
  const query = getCanonicalListQuery(searchParams);
  const detailHref = getAttendanceDetailHref(attendanceId, query);
  const detailPath = `/admin/attendance/${encodeURIComponent(attendanceId)}`;
  const correctionHref = `${detailPath}/edit${query ? `?${query}` : ""}`;
  return { detailHref, correctionHref };
}

export function getAttendanceCreationNavigationLinks(
  searchParams: AttendanceNavigationSearchParams,
): AttendanceCreationNavigationLinks {
  const query = getCanonicalListQuery(searchParams);
  const querySuffix = query ? `?${query}` : "";
  return {
    canonicalQuery: query,
    creationHref: `/admin/attendance/new${querySuffix}`,
  };
}

export function getAttendanceDetailHref(
  attendanceId: string,
  canonicalQuery: string,
): string {
  const detailPath = `/admin/attendance/${encodeURIComponent(attendanceId)}`;
  return canonicalQuery ? `${detailPath}?${canonicalQuery}` : detailPath;
}

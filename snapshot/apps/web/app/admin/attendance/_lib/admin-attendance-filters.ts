import {
  type AttendanceStatus,
  attendanceUserIdSchema,
  type WorkPeriod,
} from "@repo/contracts";
import {
  createParser,
  createSerializer,
  type inferParserType,
} from "nuqs/server";
import { getTokyoDate } from "../../../../lib/tokyo-date-time";

export type AttendanceFilters = {
  startAttendanceDateInclusive: string;
  endAttendanceDateInclusive: string;
  userId: string;
  workPeriod: "" | WorkPeriod;
  status: "" | AttendanceStatus;
};

export function getCanonicalAttendanceFilterQuery(
  rawSearchParams: Record<string, string | string[] | undefined>,
  parsedQuery: ParsedAttendanceFilterQuery,
): string | null {
  if (
    typeof rawSearchParams.from !== "string" ||
    typeof rawSearchParams.to !== "string" ||
    parsedQuery.from === null ||
    parsedQuery.to === null ||
    !isValidAttendanceDateRange(parsedQuery.from, parsedQuery.to)
  ) {
    return null;
  }
  return serializeAdminAttendanceFilterQuery({
    from: parsedQuery.from,
    to: parsedQuery.to,
    userId:
      typeof rawSearchParams.userId === "string"
        ? parsedQuery.userId || null
        : null,
    workPeriod:
      typeof rawSearchParams.workPeriod === "string"
        ? parsedQuery.workPeriod
        : null,
    status:
      typeof rawSearchParams.status === "string" ? parsedQuery.status : null,
  }).replace(/^\?/, "");
}

const attendanceDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidAttendanceDate(value: string): boolean {
  const match = attendanceDatePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  daysInMonth.setUTCMonth(daysInMonth.getUTCMonth() + 1, 0);
  return (
    day <= daysInMonth.getUTCDate() && daysInMonth.getUTCFullYear() === year
  );
}

const attendanceDateParser = createParser({
  parse: (value) => (isValidAttendanceDate(value) ? value : null),
  serialize: (value: string) => value,
});

export const adminAttendanceFilterParsers = {
  from: attendanceDateParser,
  to: attendanceDateParser,
  userId: createParser({
    parse: (value) =>
      attendanceUserIdSchema.safeParse(value).success ? value : null,
    serialize: (value: string) => value,
  }),
  workPeriod: createParser<WorkPeriod>({
    parse: (value) => (value === "day" || value === "night" ? value : null),
    serialize: (value) => value,
  }),
  status: createParser<AttendanceStatus | "cancelled">({
    parse: (value) =>
      value === "working" || value === "completed" || value === "cancelled"
        ? value
        : null,
    serialize: (value) => value,
  }),
};

export type ParsedAttendanceFilterQuery = inferParserType<
  typeof adminAttendanceFilterParsers
>;

const serializeAdminAttendanceFilterQuery = createSerializer(
  adminAttendanceFilterParsers,
  { clearOnDefault: false },
);

export function getDefaultAttendanceFilters(
  now: Date = new Date(),
): AttendanceFilters {
  const endAttendanceDateInclusive = getTokyoDate(now);
  const startDate = new Date(`${endAttendanceDateInclusive}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const startAttendanceDateInclusive = startDate.toISOString().slice(0, 10);
  return {
    startAttendanceDateInclusive,
    endAttendanceDateInclusive,
    userId: "",
    workPeriod: "",
    status: "",
  };
}

export function isValidAttendanceDateRange(
  startAttendanceDateInclusive: string,
  endAttendanceDateInclusive: string,
): boolean {
  if (
    !isValidAttendanceDate(startAttendanceDateInclusive) ||
    !isValidAttendanceDate(endAttendanceDateInclusive)
  ) {
    return false;
  }
  return startAttendanceDateInclusive <= endAttendanceDateInclusive;
}

export function parseAttendanceFilters(
  searchParams: URLSearchParams,
  now?: Date,
): AttendanceFilters {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from === null || to === null || !isValidAttendanceDateRange(from, to)) {
    return getDefaultAttendanceFilters(now);
  }

  const userId =
    adminAttendanceFilterParsers.userId.parse(
      searchParams.get("userId") ?? "",
    ) ?? "";
  const workPeriodValue = adminAttendanceFilterParsers.workPeriod.parse(
    searchParams.get("workPeriod") ?? "",
  );
  const statusValue = adminAttendanceFilterParsers.status.parse(
    searchParams.get("status") ?? "",
  );
  return {
    startAttendanceDateInclusive: from,
    endAttendanceDateInclusive: to,
    userId,
    workPeriod: workPeriodValue ?? "",
    status: statusValue ?? "",
  };
}

export function serializeAttendanceFilters(
  filters: AttendanceFilters,
): URLSearchParams {
  return new URLSearchParams(
    serializeAdminAttendanceFilterQuery({
      from: filters.startAttendanceDateInclusive,
      to: filters.endAttendanceDateInclusive,
      userId: filters.userId || null,
      workPeriod: filters.workPeriod || null,
      status: filters.status || null,
    }),
  );
}

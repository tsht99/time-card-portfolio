import type {
  AttendanceEventType,
  StaffAttendanceItem,
  WorkPeriod,
} from "@repo/contracts";

type StaffClockState =
  | "not_working"
  | "working_day"
  | "working_night"
  | "ambiguous";

export type AttendanceViewModel = {
  clockState: StaffClockState;
  clockOutTarget: StaffAttendanceItem | null;
  availableEventTypes: Record<WorkPeriod, AttendanceEventType[]>;
  canStart: Record<WorkPeriod, boolean>;
};

export function deriveAttendanceViewModel(
  attendances: readonly StaffAttendanceItem[] | undefined,
): AttendanceViewModel {
  const active = (attendances ?? []).filter(
    (attendance) => attendance.clockOutAt === null,
  );
  const workingPeriod = active.length === 1 ? active[0].workPeriod : null;
  let clockState: StaffClockState = "not_working";
  if (active.length > 1) clockState = "ambiguous";
  else if (workingPeriod)
    clockState = workingPeriod === "day" ? "working_day" : "working_night";

  const canStart = {
    day: active.length === 0,
    night: active.length === 0,
  } satisfies Record<WorkPeriod, boolean>;
  const availableEventTypes = {
    day: getAvailableEventTypes(active, "day"),
    night: getAvailableEventTypes(active, "night"),
  };
  return {
    clockState,
    clockOutTarget: active.length === 1 ? active[0] : null,
    availableEventTypes,
    canStart,
  };
}

function getAvailableEventTypes(
  working: readonly StaffAttendanceItem[] | undefined,
  workPeriod: WorkPeriod | null,
): AttendanceEventType[] {
  if (!workPeriod) return [];
  const active = working ?? [];
  if (active.length > 1) return [];
  if (active.length === 0) return ["clock_in"];
  return active[0]?.workPeriod === workPeriod ? ["clock_out"] : [];
}

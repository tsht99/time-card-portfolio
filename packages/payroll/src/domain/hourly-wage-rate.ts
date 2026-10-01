export const workPeriods = ["day", "night"] as const;
export type WorkPeriod = (typeof workPeriods)[number];

export const hourlyWageDayTypes = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "holiday",
] as const;

export type HourlyWageDayType = (typeof hourlyWageDayTypes)[number];

/** Payroll の業務ルールとして時給額の有効範囲を一元管理する。 */
export function isValidHourlyWage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 99_999
  );
}

export function isValidAttendanceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export type HourlyWageRate = {
  userId: string;
  workPeriod: WorkPeriod;
  dayType: HourlyWageDayType;
  hourlyWage: number;
  effectiveFrom: string;
};

export type HourlyWageRateSelection = {
  userId: string;
  workPeriod: WorkPeriod;
  dayType: HourlyWageDayType;
  attendanceDate: string;
};

export function findApplicableHourlyWageRate(
  rates: readonly HourlyWageRate[],
  selection: HourlyWageRateSelection,
): HourlyWageRate | null {
  return rates.reduce<HourlyWageRate | null>((selectedRate, rate) => {
    if (
      rate.userId !== selection.userId ||
      rate.workPeriod !== selection.workPeriod ||
      rate.dayType !== selection.dayType ||
      rate.effectiveFrom > selection.attendanceDate
    ) {
      return selectedRate;
    }

    if (
      selectedRate === null ||
      rate.effectiveFrom > selectedRate.effectiveFrom
    ) {
      return rate;
    }

    return selectedRate;
  }, null);
}

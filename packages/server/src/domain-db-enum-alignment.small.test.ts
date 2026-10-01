import type { AttendanceDomainEvent, WorkPeriod } from "@repo/attendance";
import type {
  attendanceEventTypeEnum,
  hourlyWageDayTypeEnum,
  userRoleEnum,
  userStatusEnum,
  workPeriodEnum,
} from "@repo/db";
import type { createHourlyWageRateRequestSchema } from "@repo/payroll/contracts";
import type { UserRole, UserStatus } from "@repo/users";

type EnumValue<Enum extends { enumValues: readonly string[] }> =
  Enum["enumValues"][number];

type HourlyWageDayType = ReturnType<
  typeof createHourlyWageRateRequestSchema.parse
>["dayType"];

type Exact<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

type Assert<T extends true> = T;

export type DomainDbEnumAlignment = [
  Assert<Exact<EnumValue<typeof userRoleEnum>, UserRole>>,
  Assert<Exact<EnumValue<typeof userStatusEnum>, UserStatus>>,
  Assert<Exact<EnumValue<typeof workPeriodEnum>, WorkPeriod>>,
  Assert<Exact<EnumValue<typeof hourlyWageDayTypeEnum>, HourlyWageDayType>>,
  Assert<
    Exact<
      EnumValue<typeof attendanceEventTypeEnum>,
      AttendanceDomainEvent["eventType"]
    >
  >,
];

import assert from "node:assert/strict";
import test from "node:test";
import type { HourlyWageDayType } from "../domain/hourly-wage-rule.ts";
import { hourlyWageDayTypes } from "../domain/hourly-wage-rule.ts";
import type { hourlyWageDayTypeEnum } from "../schema/enums.ts";
import { hourlyWageDayTypeEnum as dayTypeEnum } from "../schema/enums.ts";

type EnumValue<Enum extends { enumValues: readonly string[] }> =
  Enum["enumValues"][number];
type Exact<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type Assert<T extends true> = T;

export type PayrollSchemaDbEnumAlignment = Assert<
  Exact<EnumValue<typeof hourlyWageDayTypeEnum>, HourlyWageDayType>
>;

test("payroll day-type schema enum matches the domain canonical values", () => {
  assert.deepEqual(dayTypeEnum.enumValues, hourlyWageDayTypes);
});

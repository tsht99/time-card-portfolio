import assert from "node:assert/strict";
import test from "node:test";
import type { UserAccessStatus, UserRole } from "../domain/user.ts";
import type { userRoleEnum, userStatusEnum } from "./enums.ts";
import {
  userRoleEnum as roleEnum,
  userStatusEnum as statusEnum,
} from "./enums.ts";

type EnumValue<Enum extends { enumValues: readonly string[] }> =
  Enum["enumValues"][number];
type Exact<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type Assert<T extends true> = T;

export type UserDbEnumAlignment = [
  Assert<Exact<EnumValue<typeof userRoleEnum>, UserRole>>,
  Assert<Exact<EnumValue<typeof userStatusEnum>, UserAccessStatus>>,
];

test("user schema enums match the user domain values", () => {
  assert.deepEqual(roleEnum.enumValues, ["staff", "admin"]);
  assert.deepEqual(statusEnum.enumValues, ["pending", "active", "inactive"]);
});

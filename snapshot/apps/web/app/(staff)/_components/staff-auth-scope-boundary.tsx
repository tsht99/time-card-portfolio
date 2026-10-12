import { Fragment, type ReactNode } from "react";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { getStaffAuthScopeKey } from "../_lib/staff-auth-scope.ts";

export function StaffAuthScopeBoundary({
  initialAuth,
  children,
}: {
  initialAuth: AuthBootstrapState;
  children: ReactNode;
}) {
  return (
    <Fragment key={getStaffAuthScopeKey(initialAuth)}>{children}</Fragment>
  );
}

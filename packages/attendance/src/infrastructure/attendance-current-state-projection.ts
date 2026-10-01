// A new readiness key prevents pre-cancellation rows from being treated as a
// complete projection after the schema gains cancellation state.
export const attendanceCurrentStateProjectionName =
  "attendance-current-state-v2";

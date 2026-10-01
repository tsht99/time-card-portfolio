/** The user fields Payroll needs when loading or managing a user's payroll. */
type PayrollUserReference = {
  userId: string;
  role: "staff" | "admin";
  displayName: string | null;
};

/** Payroll-owned read boundary for one target user. */
export type PayrollUserReferenceReader = {
  getUserById(userId: string): Promise<PayrollUserReference | null>;
};

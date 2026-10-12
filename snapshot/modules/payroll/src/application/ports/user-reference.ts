/** User fields needed for hourly wage rule management and payroll estimates. */
type PayrollUserReference = {
  userId: string;
  role: string;
  displayName: string | null;
  status: string;
};

/** Payroll context read boundary for one target user. */
export type PayrollUserReferenceReader = {
  getUserById(userId: string): Promise<PayrollUserReference | null>;
  getUsers?(): Promise<PayrollUserReference[]>;
};

export type PayrollUnitOfWork = {
  run<T>(
    operation: (context: {
      users: PayrollUserReferenceReader;
      hourlyWageRuleManagementPersistence: import("./hourly-wage-rule-ports.ts").HourlyWageRuleManagementPersistencePort;
      hourlyWageRuleReadStore: import("./hourly-wage-rule-ports.ts").HourlyWageRuleReadStore;
    }) => Promise<T>,
  ): Promise<T>;
};

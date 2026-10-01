import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAdminAuthSession: vi.fn(),
  bulkUpdateHourlyWageRates: vi.fn(),
  reportUnexpectedServerException: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/server/auth-session", () => ({
  resolveAdminAuthSession: mocks.resolveAdminAuthSession,
}));
vi.mock("../lib/server/payroll-composition", () => ({
  createHourlyWageRateManagementApplication: () => ({
    bulkUpdateHourlyWageRates: mocks.bulkUpdateHourlyWageRates,
  }),
}));
vi.mock("../lib/server/users-access", () => ({
  createTimeCardUserManagementApplication: vi.fn(),
}));
vi.mock("../lib/server-observability", () => ({
  reportUnexpectedServerException: mocks.reportUnexpectedServerException,
}));

describe("bulk hourly wage Server Action infrastructure failures", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveAdminAuthSession.mockReset();
    mocks.bulkUpdateHourlyWageRates.mockReset();
    mocks.reportUnexpectedServerException.mockReset();
    mocks.resolveAdminAuthSession.mockResolvedValue({
      status: "ready",
      user: { userId: "admin-1", role: "admin" },
    });
  });

  test("returns a safe error and reports the original database exception", async () => {
    const error = Object.assign(
      new Error("raw PostgreSQL connection details"),
      {
        code: "40001",
      },
    );
    mocks.bulkUpdateHourlyWageRates.mockRejectedValue(error);
    const { bulkUpdateAdminHourlyWageRatesAction } = await import(
      "../app/admin/_actions/user-management-actions.ts"
    );

    const result = await bulkUpdateAdminHourlyWageRatesAction({
      userId: "staff-1",
      effectiveFrom: "2026-10-01",
      changes: [
        {
          dayType: "mon",
          workPeriod: "day",
          hourlyWage: 1200,
          expectedBaseline: null,
        },
      ],
    });

    expect(result).toEqual({
      success: false,
      message: "時給を更新できませんでした。",
    });
    expect(JSON.stringify(result)).not.toContain("raw PostgreSQL");
    expect(mocks.reportUnexpectedServerException).toHaveBeenCalledWith(
      error,
      "admin.hourly-wage.action.bulk-update",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  type AttendanceFilters,
  isValidAttendanceDateRange,
  parseAttendanceFilters,
  serializeAttendanceFilters,
} from "./admin-attendance-filters";

describe("admin attendance filters", () => {
  it("calculates a seven-day default period from the Tokyo date", () => {
    expect(
      parseAttendanceFilters(
        new URLSearchParams(),
        new Date("2026-09-22T00:00:00.000Z"),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2026-09-16",
      endAttendanceDateInclusive: "2026-09-22",
      userId: "",
      workPeriod: "",
      status: "",
    });
  });

  it("handles the Tokyo date boundary", () => {
    expect(
      parseAttendanceFilters(
        new URLSearchParams(),
        new Date("2026-08-31T14:59:59.999Z"),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2026-08-25",
      endAttendanceDateInclusive: "2026-08-31",
      userId: "",
      workPeriod: "",
      status: "",
    });
    expect(
      parseAttendanceFilters(
        new URLSearchParams(),
        new Date("2026-08-31T15:00:00.000Z"),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2026-08-26",
      endAttendanceDateInclusive: "2026-09-01",
      userId: "",
      workPeriod: "",
      status: "",
    });
  });

  it("handles a month boundary", () => {
    expect(
      parseAttendanceFilters(
        new URLSearchParams(),
        new Date("2026-03-01T00:00:00.000Z"),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2026-02-23",
      endAttendanceDateInclusive: "2026-03-01",
      userId: "",
      workPeriod: "",
      status: "",
    });
  });

  it("handles a year boundary", () => {
    expect(
      parseAttendanceFilters(
        new URLSearchParams(),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2025-12-26",
      endAttendanceDateInclusive: "2026-01-01",
      userId: "",
      workPeriod: "",
      status: "",
    });
  });

  it("handles a leap day", () => {
    expect(
      parseAttendanceFilters(
        new URLSearchParams(),
        new Date("2024-02-29T00:00:00.000Z"),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2024-02-23",
      endAttendanceDateInclusive: "2024-02-29",
      userId: "",
      workPeriod: "",
      status: "",
    });
  });

  it("restores all filters from a valid URL", () => {
    expect(
      parseAttendanceFilters(
        new URLSearchParams(
          "from=2026-02-01&to=2026-02-28&userId=user-1&workPeriod=night&status=working",
        ),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2026-02-01",
      endAttendanceDateInclusive: "2026-02-28",
      userId: "user-1",
      workPeriod: "night",
      status: "working",
    });
  });

  it.each([
    ["from=2026-02-01", "missing to"],
    ["from=2026-02-30&to=2026-03-01", "invalid calendar date"],
    ["from=2026-04-01&to=2026-03-31", "reversed range"],
  ])("falls back to the default for %s", (query) => {
    const now = new Date("2026-05-15T00:00:00.000Z");
    expect(parseAttendanceFilters(new URLSearchParams(query), now)).toEqual({
      startAttendanceDateInclusive: "2026-05-09",
      endAttendanceDateInclusive: "2026-05-15",
      userId: "",
      workPeriod: "",
      status: "",
    });
  });

  it("ignores invalid optional filters for a valid date range", () => {
    expect(
      parseAttendanceFilters(
        new URLSearchParams(
          "from=2026-02-01&to=2026-02-28&userId=&workPeriod=evening&status=incomplete",
        ),
      ),
    ).toEqual({
      startAttendanceDateInclusive: "2026-02-01",
      endAttendanceDateInclusive: "2026-02-28",
      userId: "",
      workPeriod: "",
      status: "",
    });
  });

  it("serializes only required and non-empty filters", () => {
    expect(
      serializeAttendanceFilters({
        startAttendanceDateInclusive: "2026-02-01",
        endAttendanceDateInclusive: "2026-02-28",
        userId: "user-1",
        workPeriod: "",
        status: "completed",
      }).toString(),
    ).toBe("from=2026-02-01&to=2026-02-28&userId=user-1&status=completed");
  });

  it("round-trips valid filters", () => {
    const filters: AttendanceFilters = {
      startAttendanceDateInclusive: "2024-02-01",
      endAttendanceDateInclusive: "2024-02-29",
      userId: "user with spaces",
      workPeriod: "day",
      status: "completed",
    };
    expect(parseAttendanceFilters(serializeAttendanceFilters(filters))).toEqual(
      filters,
    );
  });

  it("round-trips the UI-only cancelled status", () => {
    const filters: AttendanceFilters = {
      startAttendanceDateInclusive: "2024-02-01",
      endAttendanceDateInclusive: "2024-02-29",
      userId: "user-1",
      workPeriod: "day",
      status: "cancelled",
    };
    const serialized = serializeAttendanceFilters(filters);
    expect(serialized.get("status")).toBe("cancelled");
    expect(parseAttendanceFilters(serialized)).toEqual(filters);
  });

  it("validates real calendar dates and their order", () => {
    expect(isValidAttendanceDateRange("2024-02-29", "2024-03-01")).toBe(true);
    expect(isValidAttendanceDateRange("2025-02-29", "2025-03-01")).toBe(false);
    expect(isValidAttendanceDateRange("2026-03-01", "2026-02-28")).toBe(false);
  });
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { getServerReferenceTime } from "./reference-time";

const originalRuntime = process.env.E2E_WEB_RUNTIME;
const originalFixedNow = process.env.TIMECARD_E2E_FIXED_NOW;

function restoreEnvironmentVariable(
  name: "E2E_WEB_RUNTIME" | "TIMECARD_E2E_FIXED_NOW",
  value: string | undefined,
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnvironmentVariable("E2E_WEB_RUNTIME", originalRuntime);
  restoreEnvironmentVariable("TIMECARD_E2E_FIXED_NOW", originalFixedNow);
  vi.useRealTimers();
});

describe("server reference time", () => {
  test("通常実行では E2E 固定値を使用しない", () => {
    const actualNow = new Date("2026-09-17T03:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(actualNow);
    process.env.E2E_WEB_RUNTIME = "test";
    process.env.TIMECARD_E2E_FIXED_NOW = "2000-01-01T00:00:00.000Z";

    expect(getServerReferenceTime()).toEqual(actualNow);
  });

  test.each(["production", "development"])(
    "E2E の %s 実行では明示した固定値を再現する",
    (runtime) => {
      const fixedNow = "2026-08-22T12:00:00.000Z";
      process.env.E2E_WEB_RUNTIME = runtime;
      process.env.TIMECARD_E2E_FIXED_NOW = fixedNow;

      expect(getServerReferenceTime()).toEqual(new Date(fixedNow));
    },
  );

  test("E2E 実行でも固定値が空なら実時計を返す", () => {
    const actualNow = new Date("2026-09-17T03:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(actualNow);
    process.env.E2E_WEB_RUNTIME = "production";
    process.env.TIMECARD_E2E_FIXED_NOW = "";

    expect(getServerReferenceTime()).toEqual(actualNow);
  });

  test("不正な固定値は実時計へ fallback せず拒否する", () => {
    process.env.E2E_WEB_RUNTIME = "production";
    process.env.TIMECARD_E2E_FIXED_NOW = "not-a-date";

    expect(() => getServerReferenceTime()).toThrow(
      "TIMECARD_E2E_FIXED_NOW must be a valid date.",
    );
  });
});

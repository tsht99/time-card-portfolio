import { afterEach, describe, expect, test, vi } from "vitest";
import { getServerReferenceTime } from "./reference-time";

const originalRuntime = process.env.WEB_TEST_RUNTIME;
const originalFixedNow = process.env.TIMECARD_TEST_FIXED_NOW;

function restoreEnvironmentVariable(
  name: "WEB_TEST_RUNTIME" | "TIMECARD_TEST_FIXED_NOW",
  value: string | undefined,
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnvironmentVariable("WEB_TEST_RUNTIME", originalRuntime);
  restoreEnvironmentVariable("TIMECARD_TEST_FIXED_NOW", originalFixedNow);
  vi.useRealTimers();
});

describe("server reference time", () => {
  test("通常実行では test 固定値を使用しない", () => {
    const actualNow = new Date("2026-09-17T03:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(actualNow);
    process.env.WEB_TEST_RUNTIME = "test";
    process.env.TIMECARD_TEST_FIXED_NOW = "2000-01-01T00:00:00.000Z";

    expect(getServerReferenceTime()).toEqual(actualNow);
  });

  test.each(["production", "development"])(
    "%s runtime では明示した固定値を再現する",
    (runtime) => {
      const fixedNow = "2026-08-22T12:00:00.000Z";
      process.env.WEB_TEST_RUNTIME = runtime;
      process.env.TIMECARD_TEST_FIXED_NOW = fixedNow;

      expect(getServerReferenceTime()).toEqual(new Date(fixedNow));
    },
  );

  test("Web Medium runtime でも固定値が空なら実時計を返す", () => {
    const actualNow = new Date("2026-09-17T03:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(actualNow);
    process.env.WEB_TEST_RUNTIME = "production";
    process.env.TIMECARD_TEST_FIXED_NOW = "";

    expect(getServerReferenceTime()).toEqual(actualNow);
  });

  test("不正な固定値は実時計へ fallback せず拒否する", () => {
    process.env.WEB_TEST_RUNTIME = "production";
    process.env.TIMECARD_TEST_FIXED_NOW = "not-a-date";

    expect(() => getServerReferenceTime()).toThrow(
      "TIMECARD_TEST_FIXED_NOW must be a valid date.",
    );
  });
});

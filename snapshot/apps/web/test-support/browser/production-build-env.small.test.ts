import { describe, expect, it } from "vitest";
import { getProductionBuildEnv } from "./production-build-env";

describe("production browser test build environment", () => {
  it("passes the test Help URL even when Turbo provides an empty value", () => {
    const env = getProductionBuildEnv(
      { NEXT_PUBLIC_HELP_URL: "" },
      { NEXT_PUBLIC_HELP_URL: "https://help.example.test" },
    );

    expect(env.NEXT_PUBLIC_HELP_URL).toBe("https://help.example.test");
  });
});

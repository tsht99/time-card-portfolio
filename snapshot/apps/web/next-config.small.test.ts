import { describe, expect, it } from "vitest";
import { nextConfig } from "./next.config";

describe("Next.js response headers", () => {
  it("prevents every route from being embedded in a frame", async () => {
    const configuredHeaders = await nextConfig.headers?.();

    expect(configuredHeaders).toEqual([
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePostgresConnectionString } from "./connection-string.ts";

describe("normalizePostgresConnectionString", () => {
  for (const sslmode of ["require", "prefer", "verify-ca"]) {
    it(`changes sslmode=${sslmode} to verify-full`, () => {
      const result = normalizePostgresConnectionString(
        `postgresql://user:password@host:5432/database?sslmode=${sslmode}`,
      );

      assert.equal(
        result,
        "postgresql://user:password@host:5432/database?sslmode=verify-full",
      );
    });
  }

  it("keeps sslmode=verify-full", () => {
    const url =
      "postgresql://user:password@host:5432/database?sslmode=verify-full";
    assert.equal(normalizePostgresConnectionString(url), url);
  });

  it("keeps a connection string without sslmode", () => {
    const url = "postgresql://user:password@host:5432/database";
    assert.equal(normalizePostgresConnectionString(url), url);
  });

  it("keeps other query parameters", () => {
    const result = normalizePostgresConnectionString(
      "postgresql://user:password@host:5432/database?application_name=time-card&connect_timeout=10&sslmode=require",
    );

    assert.equal(
      result,
      "postgresql://user:password@host:5432/database?application_name=time-card&connect_timeout=10&sslmode=verify-full",
    );
  });
});

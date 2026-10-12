import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import { listenForPoolErrors } from "./pool-error-handler.ts";

describe("database pool error handling", () => {
  for (const driver of ["neon-serverless", "node-postgres"] as const) {
    it(`${driver}のerror eventを安全に診断する`, () => {
      const pool = new EventEmitter();
      const logs: unknown[][] = [];
      const originalError = console.error;
      console.error = (...values: unknown[]) => logs.push(values);

      try {
        listenForPoolErrors(pool, driver);
        assert.equal(pool.listenerCount("error"), 1);
        pool.emit("error", {
          code: "ECONNRESET",
          message: "postgres://user:password@host/db?sslmode=secret-token",
        });
      } finally {
        console.error = originalError;
      }

      assert.equal(logs.length, 1);
      assert.equal(logs[0]?.[0], "Database connection pool emitted an error");
      assert.deepEqual(logs[0]?.[1], { driver, code: "ECONNRESET" });
      assert.doesNotMatch(
        JSON.stringify(logs),
        /password|secret-token|postgres:\/\//,
      );
    });
  }

  it("形式外のcodeとError本文をログに含めない", () => {
    const pool = new EventEmitter();
    const logs: unknown[][] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => logs.push(values);

    try {
      listenForPoolErrors(pool, "node-postgres");
      pool.emit("error", new Error("secret password=very-secret"));
    } finally {
      console.error = originalError;
    }

    assert.deepEqual(logs[0]?.[1], { driver: "node-postgres" });
    assert.doesNotMatch(JSON.stringify(logs), /very-secret|password/);
  });
});

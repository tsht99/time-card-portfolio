import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import { createMonitoredPool } from "./connection-pool.ts";

describe("database connection pools", () => {
  for (const driver of ["neon-serverless", "node-postgres"] as const) {
    it(`${driver} pool uses the shared connection timeout and error monitoring`, () => {
      const optionsSeen: unknown[] = [];
      class TestPool extends EventEmitter {
        constructor(options: unknown) {
          super();
          optionsSeen.push(options);
        }
      }

      const pool = createMonitoredPool(
        TestPool,
        "postgresql://example.test/db",
        driver,
      );

      assert.deepEqual(optionsSeen, [
        {
          connectionString: "postgresql://example.test/db",
          connectionTimeoutMillis: 10_000,
        },
      ]);
      assert.equal(pool.listenerCount("error"), 1);
    });
  }
});

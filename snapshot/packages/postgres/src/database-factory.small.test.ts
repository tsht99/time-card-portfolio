import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDatabaseFactory } from "./database-factory.ts";
import type { PostgresDatabase } from "./index.ts";

function createFakeDatabase() {
  return {} as PostgresDatabase;
}

describe("runtime database factory", () => {
  for (const environment of ["preview", "production"] as const) {
    it(`${environment}ではNeonを選択しnode-postgresを呼ばない`, () => {
      let neonCalls = 0;
      let nodePostgresCalls = 0;
      const neon = createFakeDatabase();
      const getDatabase = createDatabaseFactory({
        createNodePostgresDatabase: () => {
          nodePostgresCalls += 1;
          return createFakeDatabase();
        },
        createNeonDatabase: () => {
          neonCalls += 1;
          return neon;
        },
      });

      assert.equal(
        getDatabase("postgresql://localhost:5432/timecard", environment),
        neon,
      );
      assert.equal(neonCalls, 1);
      assert.equal(nodePostgresCalls, 0);
    });
  }

  it("localではnode-postgresを選択しNeonを呼ばない", () => {
    let neonCalls = 0;
    let nodePostgresCalls = 0;
    const nodePostgres = createFakeDatabase();
    const getDatabase = createDatabaseFactory({
      createNodePostgresDatabase: () => {
        nodePostgresCalls += 1;
        return nodePostgres;
      },
      createNeonDatabase: () => {
        neonCalls += 1;
        return createFakeDatabase();
      },
    });

    assert.equal(
      getDatabase("postgresql://localhost:5432/timecard", "local"),
      nodePostgres,
    );
    assert.equal(nodePostgresCalls, 1);
    assert.equal(neonCalls, 0);
  });

  it("environmentとURLをキーにdatabaseを再利用する", () => {
    const local = createFakeDatabase();
    const preview = createFakeDatabase();
    let localCalls = 0;
    let neonCalls = 0;
    const getDatabase = createDatabaseFactory({
      createNodePostgresDatabase: () => {
        localCalls += 1;
        return local;
      },
      createNeonDatabase: () => {
        neonCalls += 1;
        return preview;
      },
    });

    assert.equal(
      getDatabase("postgresql://localhost:5432/timecard", "local"),
      local,
    );
    assert.equal(
      getDatabase("postgresql://localhost:5432/timecard", "local"),
      local,
    );
    assert.equal(
      getDatabase("postgresql://localhost:5432/timecard", "preview"),
      preview,
    );
    assert.equal(
      getDatabase("postgresql://localhost:5432/another", "local"),
      local,
    );
    assert.equal(localCalls, 2);
    assert.equal(neonCalls, 1);
  });

  it("DATABASE_ENVIRONMENT未指定・不正値とDATABASE_URL未指定を拒否する", () => {
    const getDatabase = createDatabaseFactory({
      createNodePostgresDatabase: createFakeDatabase,
      createNeonDatabase: createFakeDatabase,
    });

    assert.throws(
      () => getDatabase("postgresql://localhost:5432/timecard", undefined),
      /DATABASE_ENVIRONMENT is not set/,
    );
    assert.throws(
      () => getDatabase("postgresql://localhost:5432/timecard", "test"),
      /DATABASE_ENVIRONMENT is unsupported/,
    );
    assert.throws(
      () => getDatabase(undefined, "local"),
      /DATABASE_URL is not set/,
    );
  });
});

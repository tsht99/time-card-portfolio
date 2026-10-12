import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test as nodeTest } from "node:test";

const registeredTests = [];
let collectingFixtures = false;
const testContext = new AsyncLocalStorage();
const fixtures = [];
const fixtureResults = new Map();
let releaseBatch;
const batchReady = new Promise((resolve) => {
  releaseBatch = resolve;
});

function test(name, run) {
  registeredTests.push({ name, run });
  nodeTest(name, async () => {
    await batchReady;
    await testContext.run({ name, fixtureCounter: 0 }, run);
  });
}

nodeTest("batches dependency rule fixtures", async () => {
  try {
    collectingFixtures = true;
    for (const { name, run } of registeredTests) {
      await testContext.run({ name, fixtureCounter: 0 }, run);
    }
    collectingFixtures = false;
    await lintFixtureGroups();
  } finally {
    releaseBatch();
  }
});

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const modules = ["users", "attendance", "payroll"];
const biomeBinary = path.join(
  repositoryRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "biome.cmd" : "biome",
);

async function withBiomeProject(run) {
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "timecard-dependency-rules-"),
  );

  try {
    const configPath = path.join(projectRoot, "biome.json");
    await writeFile(
      configPath,
      await readFile(path.join(repositoryRoot, "biome.json")),
    );
    await cp(
      path.join(repositoryRoot, "config", "biome"),
      path.join(projectRoot, "config", "biome"),
      { recursive: true },
    );
    return await run({ projectRoot, configPath });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function writeFixture(projectRoot, relativePath, source) {
  const fixturePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, source);
  return fixturePath;
}

async function withFixture(relativeDirectory, source, check, filename) {
  if (collectingFixtures) {
    registerFixture(relativeDirectory, source, check, filename);
    return;
  }
  check(fixtureResults.get(fixtureKey()));
}

function fixtureKey() {
  const context = testContext.getStore();
  return `${context.name}:${context.fixtureCounter++}`;
}

function registerFixture(relativeDirectory, source, check, filename) {
  const key = fixtureKey();
  const accepted =
    check === assertAccepted ||
    /accepts|may import|may compose/u.test(testContext.getStore().name);
  fixtures.push({
    key,
    group: accepted ? "allowed" : "rejected",
    relativePath: filename
      ? path.join(relativeDirectory, filename)
      : path.join(
          relativeDirectory,
          ".dependency-rules-fixture",
          `fixture-${fixtures.length}.ts`,
        ),
    source,
    check,
    expectedRule: "noRestrictedImports",
  });
}

async function lintFixtureGroups() {
  await withBiomeProject(async (project) => {
    for (const group of ["rejected", "allowed"]) {
      const batch = fixtures.filter((fixture) => fixture.group === group);
      const paths = new Map();
      for (const fixture of batch) {
        const fileFixtures = paths.get(fixture.relativePath) ?? [];
        fileFixtures.push(fixture);
        paths.set(fixture.relativePath, fileFixtures);
      }
      for (const [relativePath, fileFixtures] of paths) {
        let nextLine = 1;
        for (const fixture of fileFixtures) {
          fixture.lineStart = nextLine;
          nextLine += fixture.source.split("\n").length + 1;
          fixture.lineEnd = nextLine - 2;
        }
        await writeFixture(
          project.projectRoot,
          relativePath,
          fileFixtures.map(({ source }) => source).join("\n"),
        );
      }
      if (batch.length === 0) continue;
      const result = spawnSync(
        biomeBinary,
        [
          "lint",
          "--config-path",
          project.configPath,
          "--vcs-enabled=false",
          "--reporter=json",
          ...batch.map(({ relativePath }) =>
            path.join(project.projectRoot, relativePath),
          ),
        ],
        { cwd: project.projectRoot, encoding: "utf8" },
      );
      assert.ok(result.status === 0 || result.status === 1, outputOf(result));
      const report = JSON.parse(result.stdout);
      for (const fixture of batch) {
        const diagnostics = report.diagnostics.filter(
          (diagnostic) =>
            diagnostic.location?.path?.endsWith(fixture.relativePath) &&
            diagnostic.location.start.line >= fixture.lineStart &&
            diagnostic.location.start.line <= fixture.lineEnd,
        );
        const fixtureResult = {
          status: diagnostics.some(
            (diagnostic) => diagnostic.severity === "error",
          )
            ? 1
            : 0,
          stdout: diagnostics
            .map((diagnostic) => diagnostic.category)
            .join("\n"),
          stderr: "",
        };
        fixtureResults.set(fixture.key, fixtureResult);
        if (group === "rejected") {
          assert.match(
            fixtureResult.stdout,
            new RegExp(fixture.expectedRule, "u"),
            `${fixture.key} (${fixture.relativePath})`,
          );
        }
        try {
          fixture.check(fixtureResult);
        } catch (error) {
          error.message = `${fixture.key} (${fixture.relativePath}): ${error.message}`;
          throw error;
        }
      }
      if (group === "rejected") {
        for (const fixture of batch) {
          assert.match(
            fixtureResults.get(fixture.key).stdout,
            new RegExp(fixture.expectedRule, "u"),
            fixture.key,
          );
        }
      } else {
        for (const fixture of batch) {
          assert.equal(fixtureResults.get(fixture.key).status, 0, fixture.key);
        }
      }
    }
  });
}

async function lintRepositoryFile(relativePath) {
  if (collectingFixtures) {
    const source = await readFile(
      path.join(repositoryRoot, relativePath),
      "utf8",
    );
    registerFixture(
      path.dirname(relativePath),
      source,
      assertAccepted,
      path.basename(relativePath),
    );
    return { status: 0, stdout: "", stderr: "" };
  }
  return fixtureResults.get(fixtureKey());
}

async function withCycleFixtures(check) {
  const key = fixtureKey();
  if (collectingFixtures) {
    const directory = path.join("modules", "payroll", "src", "domain");
    fixtures.push(
      {
        key: `${key}:a`,
        group: "rejected",
        relativePath: path.join(directory, "cycle-a.ts"),
        source: 'import { b } from "./cycle-b";\nexport const a = b;\n',
        check: () => {},
        expectedRule: "noImportCycles",
      },
      {
        key: `${key}:b`,
        group: "rejected",
        relativePath: path.join(directory, "cycle-b.ts"),
        source: 'import { a } from "./cycle-a";\nexport const b = a;\n',
        check: () => {},
        expectedRule: "noImportCycles",
      },
    );
    return;
  }
  const results = [
    fixtureResults.get(`${key}:a`),
    fixtureResults.get(`${key}:b`),
  ];
  check({
    status: results.some((result) => result.status !== 0) ? 1 : 0,
    stdout: results.map((result) => result.stdout).join("\n"),
    stderr: "",
  });
}

function assertRejected(result) {
  assert.notEqual(result.status, 0, outputOf(result));
  assert.match(outputOf(result), /noRestrictedImports/u);
}

function assertAccepted(result) {
  assert.equal(result.status, 0, outputOf(result));
}

async function withModuleFixture(module, layer, source, check) {
  await withFixture(path.join("modules", module, "src", layer), source, check);
}

async function withModuleRootFixture(module, source, check) {
  if (collectingFixtures) {
    registerFixture(
      path.join("modules", module, "src"),
      source,
      check,
      `dependency-rules-fixture-${fixtures.length}.ts`,
    );
    return;
  }
  check(fixtureResults.get(fixtureKey()));
}

async function withModuleIndexFixture(module, source, check) {
  await withFixture(
    path.join("modules", module, "src"),
    source,
    check,
    "index.ts",
  );
}

function outputOf(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

for (const specifier of [
  "@repo/contracts",
  "@repo/db",
  "@repo/payroll",
  "@repo/ui",
  "@repo/db/schema",
  "../../db/src/schema",
  "@repo/users/infrastructure/store",
  "next/server",
]) {
  test(`PostgreSQL package rejects ${specifier}`, async () => {
    await withFixture(
      path.join("packages", "postgres", "src"),
      `import "${specifier}";\n`,
      assertRejected,
    );
  });
}

for (const specifier of [
  "@repo/postgres",
  "@repo/postgres/connection-string",
  "../../postgres/src/index",
]) {
  test(`Payroll Domain rejects ${specifier}`, async () => {
    await withFixture(
      path.join("modules", "payroll", "src", "domain"),
      `import "${specifier}";\n`,
      assertRejected,
    );
  });
}

for (const [layer, specifier] of [
  ["domain", "@repo/contracts"],
  ["application", "@repo/contracts"],
  ["domain", "@repo/payroll/infrastructure"],
  ["application", "@repo/payroll/infrastructure"],
]) {
  test(`Payroll ${layer} rejects ${specifier}`, async () => {
    await withModuleFixture(
      "payroll",
      layer,
      `import "${specifier}";\n`,
      assertRejected,
    );
  });
}

for (const [module, area] of [
  ["users", "domain"],
  ["users", "application"],
  ["users", "infrastructure"],
  ["users", "schema"],
  ["users", "root"],
  ["attendance", "domain"],
  ["attendance", "application"],
  ["attendance", "infrastructure"],
  ["attendance", "schema"],
  ["attendance", "root"],
  ["payroll", "root production files"],
  ["payroll", "application"],
  ["payroll", "infrastructure"],
  ["payroll", "schema"],
  ["payroll", "root"],
]) {
  test(`${module} ${area} production source rejects its package root import`, async () => {
    const source = `import "@repo/${module}";\n`;
    if (area === "root") {
      await withModuleIndexFixture(module, source, assertRejected);
      return;
    }
    if (area === "root production files") {
      await withModuleRootFixture(module, source, assertRejected);
      return;
    }

    await withModuleFixture(module, area, source, assertRejected);
  });
}

for (const layer of ["domain", "application"]) {
  test(`Attendance ${layer} rejects @repo/contracts`, async () => {
    await withModuleFixture(
      "attendance",
      layer,
      'import "@repo/contracts";\n',
      assertRejected,
    );
  });
}

for (const module of modules) {
  for (const [layer, specifiers] of [
    [
      "domain",
      [
        "@repo/postgres",
        "../../../../postgres/src/index",
        "@repo/db",
        "next/server",
        "drizzle-orm/pg-core",
        "../../application/use-case",
        "../../infrastructure/store",
      ],
    ],
    [
      "application",
      [
        "@repo/postgres",
        "../../../../postgres/src/index",
        "@repo/db",
        "next/server",
        "../../infrastructure/store",
      ],
    ],
  ]) {
    for (const specifier of specifiers) {
      test(`${module} ${layer} rejects ${specifier}`, async () => {
        await withModuleFixture(
          module,
          layer,
          `import "${specifier}";\n`,
          assertRejected,
        );
      });
    }
  }

  test(`${module} Infrastructure may import inner layers and PostgreSQL connection package`, async () => {
    await withModuleFixture(
      module,
      "infrastructure",
      'import "../../domain/model";\nimport "../../application/port";\nimport "@repo/postgres";\n',
      (result) => assert.equal(result.status, 0, outputOf(result)),
    );
  });

  for (const otherModule of modules.filter(
    (candidate) => candidate !== module,
  )) {
    for (const layer of ["domain", "application", "infrastructure"]) {
      test(`${module} ${layer} rejects ${otherModule} internals by alias and relative path`, async () => {
        await withModuleFixture(
          module,
          layer,
          `import "@repo/${otherModule}/src/domain/model";\nimport "../../../../${otherModule}/src/domain/model";\n`,
          (result) => {
            assertRejected(result);
            assert.ok(
              (outputOf(result).match(/noRestrictedImports/gu) ?? []).length >=
                2,
              outputOf(result),
            );
          },
        );
      });
    }
  }
}

for (const [directory, specifiers] of [
  ["modules/users/src/domain", ["@repo/users/schema", "../../schema/users"]],
  [
    "modules/users/src/application",
    ["@repo/users/schema", "../../schema/users"],
  ],
  [
    "modules/users/src/infrastructure",
    ["@repo/db", "../../../../db/src/schema/users"],
  ],
  ["modules/payroll/src", ["@repo/users/infrastructure", "@repo/users/schema"]],
  [
    "packages/contracts/src",
    [
      "@repo/users/infrastructure",
      "@repo/users/schema",
      "@repo/attendance/infrastructure",
      "@repo/attendance/schema",
      "@repo/attendance/application/attendance",
      "@repo/attendance/internal/arbitrary",
      "@repo/payroll/infrastructure",
      "@repo/payroll/schema",
      "@repo/payroll/application/attendance-payroll",
      "@repo/payroll/internal/arbitrary",
      "../../attendance/src/application/attendance-types",
      "../../payroll/src/application/attendance-payroll",
    ],
  ],
  ["packages/ui/src", ["@repo/payroll/infrastructure"]],
  ["apps/web/app/admin", ["@repo/users/infrastructure", "@repo/users/schema"]],
  [
    "apps/web/lib/server",
    ["@repo/users/application/authentication", "@repo/users/infrastructure"],
  ],
  ["packages/db/src", ["@repo/users/schema", "@repo/users/infrastructure"]],
]) {
  for (const specifier of specifiers) {
    test(`${directory} rejects ${specifier}`, async () => {
      await withFixture(directory, `import "${specifier}";\n`, assertRejected);
    });
  }
}

for (const specifier of ["@repo/payroll"]) {
  test(`packages/contracts/src accepts ${specifier} root boundary`, async () => {
    await withFixture(
      "packages/contracts/src",
      `import "${specifier}";\n`,
      assertAccepted,
    );
  });
}

for (const [directory, specifier] of [["apps/web/app/admin", "@repo/users"]]) {
  test(`${directory} accepts ${specifier} root boundary`, async () => {
    await withFixture(directory, `import "${specifier}";\n`, assertAccepted);
  });
}

for (const specifier of ["@repo/users/schema", "@repo/attendance/schema"]) {
  test(`packages/db/src/schema.ts accepts ${specifier} root boundary`, async () => {
    await withFixture(
      "packages/db/src",
      `import "${specifier}";\n`,
      assertAccepted,
      "schema.ts",
    );
  });
}

test("packages/db/src/schema.ts rejects Users Infrastructure", async () => {
  await withFixture(
    "packages/db/src",
    'import "@repo/users/infrastructure";\n',
    assertRejected,
    "schema.ts",
  );
});

for (const [specifier, typeName] of [
  ["@repo/attendance", "WorkPeriod"],
  ["@repo/payroll", "UserMonthlyPayrollEstimateSummary"],
]) {
  test(`Contracts accepts ${specifier} public root boundary`, async () => {
    await withFixture(
      path.join("packages", "contracts", "src"),
      `import type { ${typeName} } from "${specifier}";\n`,
      assertAccepted,
    );
  });
}

test("Attendance root exports no Infrastructure or schema APIs", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "modules/attendance/src/index.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:from|import)\s+["'][^"']*(?:infrastructure|schema)/u,
  );
});

async function readTypeScriptSources(directory) {
  const entries = await readdir(path.join(repositoryRoot, directory), {
    withFileTypes: true,
  });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readTypeScriptSources(entryPath);
      }
      if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) {
        return [];
      }
      return [
        {
          path: entryPath,
          source: await readFile(path.join(repositoryRoot, entryPath), "utf8"),
        },
      ];
    }),
  );
  return sources.flat();
}

test("Users persistence port is not exported from the Users package root", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "modules/users/src/index.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /user-persistence/u);
  assert.doesNotMatch(source, /\bUserReader\b/u);
});

for (const module of ["attendance", "payroll"]) {
  test(`${module} Application does not import Users UserReader`, async () => {
    const sources = await readTypeScriptSources(
      `modules/${module}/src/application`,
    );

    for (const { path: sourcePath, source } of sources) {
      assert.doesNotMatch(
        source,
        /import\s+(?:type\s+)?\{[^}]*\bUserReader\b[^}]*\}\s*from\s*["']@repo\/users["']/su,
        `${sourcePath} must use an owned query port instead of Users UserReader`,
      );
    }
  });
}

test("non-Users compositions cannot expose or pass the raw Users adapter", async () => {
  const [usersAccess, attendanceComposition, payrollComposition] =
    await Promise.all(
      [
        "apps/web/lib/server/users-composition.ts",
        "apps/web/lib/server/attendance-composition.ts",
        "apps/web/lib/server/payroll-composition.ts",
      ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
    );

  assert.doesNotMatch(usersAccess, /export\s+function\s+createUsersAdapter/u);
  assert.doesNotMatch(
    usersAccess,
    /export\s+function\s+createTimeCardUserReader/u,
  );
  assert.doesNotMatch(
    attendanceComposition,
    /createPostgresUsersAdapter|createUsersAdapter/u,
  );
  assert.doesNotMatch(
    payrollComposition,
    /createPostgresUsersAdapter|createUsersAdapter/u,
  );
});

test("Payroll Estimate applications use the Attendance public root boundary", async () => {
  for (const filename of [
    "modules/payroll/src/application/payroll-estimate.ts",
    "modules/payroll/src/application/monthly-payroll-estimate.ts",
  ]) {
    const source = await readFile(path.join(repositoryRoot, filename), "utf8");
    assert.doesNotMatch(
      source,
      /@repo\/attendance\/(?:infrastructure|schema)(?:\/|["'])/u,
      filename,
    );
  }
});

test("Web Delivery rejects direct Payroll internal imports", async () => {
  await withFixture(
    path.join("apps", "web", "lib", "server"),
    'import "@repo/payroll/infrastructure";\n',
    assertRejected,
  );
});

for (const specifier of [
  "@repo/attendance/application/use-case",
  "@repo/attendance/infrastructure/store",
  "@repo/attendance/schema",
  "../../attendance/src/domain/model",
]) {
  test(`Web Delivery rejects direct Attendance internal import ${specifier}`, async () => {
    await withFixture(
      path.join("apps", "web", "app", "admin"),
      `import "${specifier}";\n`,
      assertRejected,
    );
  });
}

test("hourly wage rules client rejects exact Attendance layer imports", async () => {
  const imports = ["application", "domain", "infrastructure", "schema"]
    .map((layer) => `import "@repo/attendance/${layer}";`)
    .join("\n");
  await withFixture(
    "apps/web/app/admin/users/[userId]/hourly-wage-rules/_components",
    `${imports}\n`,
    (result) => {
      assertRejected(result);
      assert.ok(
        (outputOf(result).match(/noRestrictedImports/gu) ?? []).length >= 4,
        outputOf(result),
      );
    },
    "hourly-wage-rules-client.tsx",
  );
});

test("Web Payroll Composition Root may compose Payroll Infrastructure", async () => {
  assertAccepted(
    await lintRepositoryFile("apps/web/lib/server/payroll-composition.ts"),
  );
});

test("web Composition Root may compose Attendance Infrastructure", async () => {
  assertAccepted(
    await lintRepositoryFile("apps/web/lib/server/attendance-composition.ts"),
  );
});

test("Attendance Composition Root rejects Attendance Application internals", async () => {
  await withFixture(
    path.join("apps", "web", "lib", "server"),
    'import "@repo/attendance/application/use-case";\n',
    assertRejected,
    "attendance-composition.ts",
  );
});

test("web Composition Root may compose Users Infrastructure", async () => {
  assertAccepted(
    await lintRepositoryFile("apps/web/lib/server/users-composition.ts"),
  );
});

test("DB schema composition directly exports module schemas", async () => {
  const compositionPath = "packages/db/src/schema.ts";
  assertAccepted(await lintRepositoryFile(compositionPath));
  const [composition, drizzleConfig, database] = await Promise.all(
    [
      compositionPath,
      "packages/db/drizzle.config.ts",
      "packages/db/src/database.ts",
    ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );
  const providerSpecifiers = await readModuleSchemaProviders();
  const composedSpecifiers = [
    ...composition.matchAll(
      /^\s*export\s+\*\s+from\s+["']([^"']+)["'];?\s*$/gmu,
    ),
  ]
    .map(([, specifier]) => specifier)
    .filter((specifier) => specifier.endsWith("/schema"));

  assert.deepEqual(
    composedSpecifiers.toSorted(),
    providerSpecifiers.toSorted(),
    "DB schema composition must directly export every module that publishes ./schema, and no other module schemas",
  );
  assert.match(drizzleConfig, /schema:\s*["']\.\/src\/schema\.ts["']/u);
  assert.match(
    database,
    /import\s+\*\s+as\s+schema\s+from\s+["']\.\/schema\.ts["']/u,
  );
});

async function readModuleSchemaProviders() {
  return readSchemaProvidersFrom(path.join(repositoryRoot, "modules"));
}

async function readSchemaProvidersFrom(modulesDirectory) {
  const entries = await readdir(modulesDirectory, { withFileTypes: true });
  const packageFiles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        const packagePath = path.join(modulesDirectory, name, "package.json");
        try {
          return JSON.parse(await readFile(packagePath, "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") return undefined;
          throw error;
        }
      }),
  );

  return packageFiles
    .filter((packageJson) => packageJson?.exports?.["./schema"])
    .map((packageJson) => `${packageJson.name}/schema`);
}

test("DB schema provider discovery uses package metadata instead of module names", async () => {
  const modulesDirectory = await mkdtemp(
    path.join(os.tmpdir(), "timecard-schema-providers-"),
  );

  try {
    const packageDirectory = path.join(modulesDirectory, "new-module");
    await mkdir(packageDirectory);
    await writeFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "@repo/new-module",
        exports: { "./schema": "./src/schema/index.ts" },
      }),
    );

    assert.deepEqual(await readSchemaProvidersFrom(modulesDirectory), [
      "@repo/new-module/schema",
    ]);
  } finally {
    await rm(modulesDirectory, { recursive: true, force: true });
  }
});

test("Users root exports only Domain and Application", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "modules/users/src/index.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:from|import)\s+["'][^"']*(?:schema|infrastructure)/u,
  );
});

test("business module roots use explicit exports", async () => {
  for (const moduleName of ["attendance", "users"]) {
    const source = await readFile(
      path.join(repositoryRoot, `modules/${moduleName}/src/index.ts`),
      "utf8",
    );
    assert.doesNotMatch(source, /export\s+(?:type\s+)?\*/u, moduleName);
  }
});

test("enum alignment tests stay with their owning modules", async () => {
  for (const file of [
    "modules/users/src/schema/db-enum-alignment.small.test.ts",
    "modules/attendance/src/schema/db-enum-alignment.small.test.ts",
    "modules/payroll/src/schema/db-enum-alignment.small.test.ts",
  ]) {
    assertAccepted(await lintRepositoryFile(file));
  }
});

test("rejects a relative import cycle", async () => {
  await withCycleFixtures((result) => {
    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /noImportCycles/u);
  });
});

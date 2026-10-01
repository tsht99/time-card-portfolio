import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
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
    return await run({ projectRoot, configPath });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function runBiomeLint({ projectRoot, configPath }, target) {
  return spawnSync(
    biomeBinary,
    ["lint", "--config-path", configPath, "--vcs-enabled=false", target],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

async function writeFixture(projectRoot, relativePath, source) {
  const fixturePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, source);
  return fixturePath;
}

async function withFixture(relativeDirectory, source, check) {
  await withBiomeProject(async (project) => {
    const fixturePath = await writeFixture(
      project.projectRoot,
      path.join(relativeDirectory, ".dependency-rules-fixture", "fixture.ts"),
      source,
    );
    check(runBiomeLint(project, fixturePath));
  });
}

async function lintRepositoryFile(relativePath) {
  return withBiomeProject(async (project) => {
    const source = await readFile(
      path.join(repositoryRoot, relativePath),
      "utf8",
    );
    const target = await writeFixture(
      project.projectRoot,
      relativePath,
      source,
    );
    return runBiomeLint(project, target);
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
  await withFixture(path.join("packages", module, "src", layer), source, check);
}

async function withModuleRootFixture(module, source, check) {
  await withBiomeProject(async (project) => {
    const fixturePath = await writeFixture(
      project.projectRoot,
      path.join("packages", module, "src", "dependency-rules-fixture.ts"),
      source,
    );
    check(runBiomeLint(project, fixturePath));
  });
}

async function withModuleIndexFixture(module, source, check) {
  await withBiomeProject(async (project) => {
    const indexPath = await writeFixture(
      project.projectRoot,
      path.join("packages", module, "src", "index.ts"),
      source,
    );
    check(runBiomeLint(project, indexPath));
  });
}

function outputOf(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

test("rejects a forbidden workspace package dependency direction", async () => {
  await withFixture(
    path.join("packages", "payroll"),
    'import "@repo/server";\n',
    assertRejected,
  );
});

for (const specifier of [
  "@repo/contracts",
  "@repo/db",
  "@repo/payroll",
  "@repo/server",
  "@repo/ui",
  "@repo/db/schema",
  "../../db/src/schema",
  "@repo/users/infrastructure/store",
  "next/server",
]) {
  test(`Platform rejects ${specifier}`, async () => {
    await withFixture(
      path.join("packages", "platform", "src"),
      `import "${specifier}";\n`,
      assertRejected,
    );
  });
}

for (const specifier of [
  "@repo/platform",
  "@repo/platform/connection-string",
  "../../platform/src/index",
]) {
  test(`Payroll Domain rejects ${specifier}`, async () => {
    await withFixture(
      path.join("packages", "payroll"),
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
  ["domain", "@repo/payroll/delivery"],
  ["application", "@repo/payroll/delivery"],
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
  ["users", "delivery"],
  ["users", "schema"],
  ["users", "root"],
  ["attendance", "domain"],
  ["attendance", "application"],
  ["attendance", "infrastructure"],
  ["attendance", "delivery"],
  ["attendance", "schema"],
  ["attendance", "root"],
  ["payroll", "root production files"],
  ["payroll", "application"],
  ["payroll", "infrastructure"],
  ["payroll", "delivery"],
  ["payroll", "schema"],
  ["payroll", "contracts"],
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
        "@repo/platform",
        "../../../../platform/src/index",
        "@repo/db",
        "next/server",
        "drizzle-orm/pg-core",
        "../../application/use-case",
        "../../infrastructure/store",
        "../../delivery/page",
      ],
    ],
    [
      "application",
      [
        "@repo/platform",
        "../../../../platform/src/index",
        "@repo/db",
        "next/server",
        "../../infrastructure/store",
        "../../delivery/page",
      ],
    ],
    ["infrastructure", ["../../delivery/page"]],
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

  test(`${module} Infrastructure may import inner layers and Platform`, async () => {
    await withModuleFixture(
      module,
      "infrastructure",
      'import "../../domain/model";\nimport "../../application/port";\nimport "@repo/platform";\n',
      (result) => assert.equal(result.status, 0, outputOf(result)),
    );
  });

  for (const otherModule of modules.filter(
    (candidate) => candidate !== module,
  )) {
    for (const layer of [
      "domain",
      "application",
      "infrastructure",
      "delivery",
    ]) {
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
  ["packages/users/src/domain", ["@repo/users/schema", "../../schema/users"]],
  [
    "packages/users/src/application",
    ["@repo/users/schema", "../../schema/users"],
  ],
  [
    "packages/users/src/infrastructure",
    ["@repo/db", "../../../../db/src/schema/users"],
  ],
  [
    "packages/payroll/src",
    ["@repo/users/infrastructure", "@repo/users/schema"],
  ],
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
      "@repo/payroll/contracts",
      "@repo/payroll/application/attendance-payroll",
      "@repo/payroll/internal/arbitrary",
      "../../attendance/src/application/attendance-types",
      "../../payroll/src/application/attendance-payroll",
    ],
  ],
  ["apps/web/app/admin", ["@repo/users/infrastructure", "@repo/users/schema"]],
  [
    "apps/web/lib/server",
    ["@repo/users/application/authentication", "@repo/users/infrastructure"],
  ],
  ["packages/db/src", ["@repo/users/schema", "@repo/users/infrastructure"]],
  ["packages/db/src/schema", ["@repo/users/infrastructure"]],
]) {
  for (const specifier of specifiers) {
    test(`${directory} rejects ${specifier}`, async () => {
      await withFixture(directory, `import "${specifier}";\n`, assertRejected);
    });
  }
}

for (const [directory, specifier] of [
  ["packages/db/src/schema", "@repo/users/schema"],
  ["packages/db/src/schema", "@repo/attendance/schema"],
  ["apps/web/app/admin", "@repo/users"],
]) {
  test(`${directory} accepts ${specifier} root boundary`, async () => {
    await withFixture(directory, `import "${specifier}";\n`, assertAccepted);
  });
}

for (const [specifier, typeName] of [
  ["@repo/attendance", "WorkPeriod"],
  ["@repo/payroll", "UserMonthlyPayrollSummary"],
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
    path.join(repositoryRoot, "packages/attendance/src/index.ts"),
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
    path.join(repositoryRoot, "packages/users/src/index.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /user-persistence/u);
  assert.doesNotMatch(source, /\bUserReader\b/u);
});

for (const module of ["attendance", "payroll"]) {
  test(`${module} Application does not import Users UserReader`, async () => {
    const sources = await readTypeScriptSources(
      `packages/${module}/src/application`,
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
        "apps/web/lib/server/users-access.ts",
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

test("Payroll Application uses the Attendance public root boundary", async () => {
  for (const filename of [
    "packages/payroll/src/application/attendance-payroll.ts",
    "packages/payroll/src/application/monthly-payroll.ts",
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

test("web Composition Root may compose Users Infrastructure", async () => {
  assertAccepted(
    await lintRepositoryFile("apps/web/lib/server/users-access.ts"),
  );
});

test("DB schema composition may import Users schema", async () => {
  assertAccepted(await lintRepositoryFile("packages/db/src/schema/users.ts"));
});

test("DB schema composition may import Payroll schema", async () => {
  assertAccepted(await lintRepositoryFile("packages/db/src/schema/index.ts"));
});

for (const filename of [
  "production-admin-bootstrap.ts",
  "production-admin-bootstrap-options.ts",
]) {
  test(`${filename} may compose Users Infrastructure`, async () => {
    assertAccepted(
      await lintRepositoryFile(`packages/server/src/cli/${filename}`),
    );
  });
}

test("Users root exports only Domain and Application", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "packages/users/src/index.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:from|import)\s+["'][^"']*(?:schema|infrastructure)/u,
  );
});

test("Server test source may use the Users root boundary", async () => {
  assertAccepted(
    await lintRepositoryFile(
      "packages/server/src/domain-db-enum-alignment.small.test.ts",
    ),
  );
});

test("Server package does not expose a generic root API", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "packages/server/package.json"),
      "utf8",
    ),
  );
  assert.equal(Object.hasOwn(manifest.exports, "."), false);
});

test("rejects a relative import cycle", async () => {
  await withBiomeProject(async (project) => {
    const fixtureDirectory = path.join(
      project.projectRoot,
      "packages",
      "payroll",
      "src",
      "domain",
    );
    await mkdir(fixtureDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(fixtureDirectory, "a.ts"),
        'import { b } from "./b";\nexport const a = b;\n',
      ),
      writeFile(
        path.join(fixtureDirectory, "b.ts"),
        'import { a } from "./a";\nexport const b = a;\n',
      ),
    ]);

    const result = runBiomeLint(project, fixtureDirectory);

    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /noImportCycles/u);
  });
});

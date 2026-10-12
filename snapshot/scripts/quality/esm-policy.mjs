import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".cache",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  ".output",
  "storybook-static",
  "vendor",
]);

// Add an exception only when a tool requires CommonJS or a declaration file
// must describe a CommonJS consumer. Keep each exception exact and documented.
export const ESM_EXCEPTIONS = new Map();

function workspacePatterns(workspaceYaml) {
  return workspaceYaml.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*-\s*["']?([^"'#]+\*[^"'#]*)["']?\s*(?:#.*)?$/u.exec(
      line,
    );
    return match ? [match[1].trim()] : [];
  });
}

async function findWorkspaces(root, patterns) {
  const workspaces = [];
  for (const pattern of patterns) {
    const parent = pattern.slice(0, pattern.indexOf("*"));
    const parentPath = path.join(root, parent);
    let entries;
    try {
      entries = await readdir(parentPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(parentPath, entry.name);
      try {
        await readFile(path.join(directory, "package.json"), "utf8");
        workspaces.push(directory);
      } catch {
        // A workspace glob can include directories that are not packages.
      }
    }
  }
  return workspaces;
}

async function findCommonJsFiles(root, directory = root, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await findCommonJsFiles(root, path.join(directory, entry.name), found);
      }
    } else if (/\.(?:cjs|cts)$/u.test(entry.name)) {
      const relative = path.relative(root, path.join(directory, entry.name));
      if (!ESM_EXCEPTIONS.has(relative)) found.push(relative);
    }
  }
  return found;
}

export async function checkEsmPolicy(root) {
  const [workspaceYaml, rootPackage] = await Promise.all([
    readFile(path.join(root, "pnpm-workspace.yaml"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
  ]);
  const workspaceDirectories = await findWorkspaces(
    root,
    workspacePatterns(workspaceYaml),
  );
  const resolvedPackages = [
    [root, rootPackage],
    ...(await Promise.all(
      workspaceDirectories.map(async (directory) => [
        directory,
        JSON.parse(
          await readFile(path.join(directory, "package.json"), "utf8"),
        ),
      ]),
    )),
  ];
  const violations = [];
  for (const [directory, packageJson] of resolvedPackages) {
    if (packageJson.type !== "module") {
      const relative = path.relative(root, directory) || ".";
      violations.push(`${relative}/package.json: expected "type": "module"`);
    }
  }
  for (const file of await findCommonJsFiles(root)) {
    violations.push(`${file}: self-authored .cjs/.cts source is not allowed`);
  }
  return violations;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const violations = await checkEsmPolicy(root);
  if (violations.length) {
    console.error("ESM policy violations:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  }
}

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
const semverIdentifier = "[0-9A-Za-z-]+";
const semverNumericIdentifier = "0|[1-9][0-9]*";
const semverPrereleaseIdentifier = `(?:${semverNumericIdentifier}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver =
  `(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)` +
  `(?:-${semverPrereleaseIdentifier}(?:\\.${semverPrereleaseIdentifier})*)?` +
  `(?:\\+${semverIdentifier}(?:\\.${semverIdentifier})*)?`;
const branchNamePattern = new RegExp(
  `^(?:main|develop|feature/(?:[0-9]+-${slug}|(?![0-9]+$)${slug})|hotfix/(?:[0-9]+-${slug}|(?![0-9]+$)${slug})|release/${semver})$`,
  "u",
);

export function isValidBranchName(branchName) {
  return branchNamePattern.test(branchName);
}

function main() {
  const result = spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  });
  const branchName = result.status === 0 ? result.stdout.trim() : "";

  if (!isValidBranchName(branchName)) {
    process.stderr.write(
      `Invalid branch name: "${branchName}". Allowed: main, develop, feature/<slug>, feature/<issue-number>-<slug>, hotfix/<slug>, hotfix/<issue-number>-<slug>, release/<version> (SemVer 2.0.0).\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

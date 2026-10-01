import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
const branchNamePattern = new RegExp(
  `^(?:main|develop|feature/(?:[0-9]+-${slug}|(?![0-9]+$)${slug})|hotfix/(?:[0-9]+-${slug}|(?![0-9]+$)${slug}))$`,
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
      `Invalid branch name: "${branchName}". Allowed: main, develop, feature/<slug>, feature/<issue-number>-<slug>, hotfix/<slug>, hotfix/<issue-number>-<slug>.\n`,
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

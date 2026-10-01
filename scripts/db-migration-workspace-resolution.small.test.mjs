import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("DB migration workspace resolution", () => {
  it("starts both migration commands with the development export condition", async () => {
    const packageJson = JSON.parse(
      await readFile(
        new URL("../packages/db/package.json", import.meta.url),
        "utf8",
      ),
    );

    assert.match(
      packageJson.scripts.migrate,
      /node .*--conditions=development .*--import tsx/,
    );
    assert.match(
      packageJson.scripts["migrate:deploy"],
      /node .*--conditions=development .*--import tsx/,
    );
  });

  it("resolves the platform workspace to its source export under that condition", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--input-type=module",
        "-e",
        'console.log(import.meta.resolve("@repo/platform"))',
      ],
      { cwd: `${root}packages/db`, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /packages\/platform\/src\/index\.ts$/);
  });
});

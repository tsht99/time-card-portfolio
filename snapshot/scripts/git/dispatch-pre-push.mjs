import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDeletionOnlyPush(input) {
  const updates = input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    updates.length > 0 &&
    updates.every((update) => {
      const fields = update.split(/\s+/u);
      return fields.length === 4 && /^(?:0{40}|0{64})$/u.test(fields[1]);
    })
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  if (!isDeletionOnlyPush(input)) {
    const result = spawnSync(
      "pnpm",
      ["exec", "lefthook", "run", "pre-push-validation"],
      { stdio: "inherit" },
    );
    if (result.error) console.error(result.error);
    process.exitCode = result.status ?? 1;
  }
}

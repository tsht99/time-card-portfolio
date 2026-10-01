import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const testEnv = parseEnv(
  readFileSync(new URL("./.env.test", import.meta.url), "utf8"),
);

Object.assign(process.env, testEnv);

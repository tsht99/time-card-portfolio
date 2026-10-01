import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig(() => {
  const testEnv = parseEnv(
    readFileSync(new URL("./.env.test", import.meta.url), "utf8"),
  );
  Object.assign(process.env, testEnv);

  return {
    plugins: [react(), tsconfigPaths()],
    resolve: {
      alias: {
        "server-only": new URL("./test/server-only.ts", import.meta.url)
          .pathname,
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./test/setup.ts"],
      env: testEnv,
    },
  };
});

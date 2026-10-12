import assert from "node:assert/strict";
import test from "node:test";

import {
  createValidationEnvironment,
  runPrePushValidation,
  validateHelpUrl,
} from "./run-pre-push-validation.mjs";

test("managed test URL overrides inherited URL without loading other test secrets", () => {
  const env = createValidationEnvironment("https://help.example.test", {
    NEXT_PUBLIC_HELP_URL: "https://personal.example.test",
    DATABASE_URL: "inherited database value",
  });

  assert.equal(env.NEXT_PUBLIC_HELP_URL, "https://help.example.test");
  assert.equal(env.DATABASE_URL, "inherited database value");
});

test("requires a valid HTTP(S) managed URL", () => {
  for (const value of [undefined, "", "not a URL", "ftp://help.example.test"]) {
    assert.throws(() => validateHelpUrl(value));
  }
  assert.equal(
    validateHelpUrl("https://help.example.test"),
    "https://help.example.test",
  );
});

test("runs only the pre-push typecheck and small-test commands with managed URL", async () => {
  let invocation;
  const status = await runPrePushValidation({
    inheritedEnv: { DATABASE_URL: "inherited value" },
    readManagedEnv: async (filePath, encoding) => {
      assert.match(filePath, /apps[\\/]web[\\/]\.env\.test$/u);
      assert.equal(encoding, "utf8");
      return "NEXT_PUBLIC_HELP_URL=https://managed.example.test\nDATABASE_URL=must-not-be-loaded\n";
    },
    run: (...args) => {
      invocation = args;
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(invocation[0], "pnpm");
  assert.deepEqual(invocation[1], [
    "exec",
    "turbo",
    "run",
    "typecheck",
    "test:small",
  ]);
  assert.equal(
    invocation[2].env.NEXT_PUBLIC_HELP_URL,
    "https://managed.example.test",
  );
  assert.equal(invocation[2].env.DATABASE_URL, "inherited value");
});

import assert from "node:assert/strict";
import test from "node:test";

import { isDeletionOnlyPush } from "./dispatch-pre-push.mjs";

const zero = "0".repeat(40);
const oid = "a".repeat(40);

test("skips validation when every pushed ref is deleted", () => {
  assert.equal(
    isDeletionOnlyPush(
      `refs/heads/old ${zero} refs/heads/old ${oid}\nrefs/tags/v1 ${zero} refs/tags/v1 ${oid}\n`,
    ),
    true,
  );
});

test("runs validation for a normal ref update", () => {
  assert.equal(
    isDeletionOnlyPush(
      `refs/heads/feature ${oid} refs/heads/feature ${zero}\n`,
    ),
    false,
  );
});

test("runs validation when deleted and updated refs are mixed", () => {
  assert.equal(
    isDeletionOnlyPush(
      `refs/heads/old ${zero} refs/heads/old ${oid}\nrefs/heads/new ${oid} refs/heads/new ${zero}\n`,
    ),
    false,
  );
});

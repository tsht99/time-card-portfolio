import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// cspell:ignore dbname
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const readWorkflow = (name) =>
  readFileSync(
    path.join(repositoryRoot, ".github", "workflows-disabled", name),
    "utf8",
  );
const backup = readWorkflow("backup-production-db.yml");
const scheduler = readWorkflow("backup-production-db-scheduler.yml");

test("daily scheduler dispatches the production backup from main without credentials", () => {
  assert.match(scheduler, /cron: "17 3 \* \* \*"[\s\S]*timezone: Asia\/Tokyo/u);
  assert.match(
    scheduler,
    /^permissions:\n {2}actions: write\n {2}contents: none\n\njobs:/mu,
  );
  assert.match(
    scheduler,
    /actions\/workflows\/backup-production-db\.yml\/dispatches/u,
  );
  assert.match(scheduler, /--field ref=main/u);
  assert.doesNotMatch(
    scheduler,
    /checkout|environment: production|secrets\.|vars\.|PRODUCTION_DATABASE_BACKUP_URL|R2_BACKUP_/u,
  );
});

test("backup workflow only runs its protected job for a main dispatch", () => {
  assert.match(backup, /on:\n {2}workflow_dispatch:/u);
  assert.doesNotMatch(backup, /^ {2}schedule:/mu);
  assert.match(backup, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(backup, /environment: production/u);
  assert.match(backup, /group: production-db-backup/u);
});

test("backup retains the pinned PostgreSQL image and dump integrity checks", () => {
  assert.match(
    backup,
    /docker\.io\/library\/postgres:18-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382/u,
  );
  assert.match(
    backup,
    /pg_dump --dbname=.*--format=custom --no-owner --no-acl/u,
  );
  assert.match(backup, /pg_restore --list/u);
  assert.match(backup, /sha256sum/u);
  assert.equal((backup.match(/docker run --rm/gu) ?? []).length, 2);
  assert.equal((backup.match(/"\$\{postgres_image\}"/gu) ?? []).length, 2);
  assert.match(
    backup,
    /aws s3 cp \\\n\s+"\$\{dump_path\}" \\\n\s+"s3:\/\/\$\{R2_BACKUP_BUCKET\}\/\$\{object_key\}"/u,
  );
  assert.match(
    backup,
    /aws s3 cp \\\n\s+"\$\{checksum_path\}" \\\n\s+"s3:\/\/\$\{R2_BACKUP_BUCKET\}\/\$\{object_key\}\.sha256"/u,
  );
  assert.match(backup, /head-object/u);
  assert.match(backup, /local_bytes="\$\(wc -c < "\$\{dump_path\}"\)"/u);
  assert.match(
    backup,
    /remote_bytes="\$\(aws s3api head-object[\s\S]*?--query ContentLength/u,
  );
  assert.match(backup, /"\$\{remote_bytes\}" != "\$\{local_bytes\}"/u);
  assert.match(backup, /Uploaded dump size does not match/u);
});

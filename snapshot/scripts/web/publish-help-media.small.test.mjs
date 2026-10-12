import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentTypeForMedia,
  HELP_MEDIA_BUCKET,
  HELP_MEDIA_CACHE_CONTROL,
  HELP_MEDIA_ROOTS,
  keyForMedia,
  publicUrl,
  publishHelpMedia,
  uploadObject,
} from "./publish-help-media.mjs";

test("defaults to the repository help image and tutorial video roots", () => {
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  assert.deepEqual(HELP_MEDIA_ROOTS, [
    join(repositoryRoot, "apps/help/public/images/generated"),
    join(repositoryRoot, "tools/tutorial-video/out"),
  ]);
});

test("uses stable relative paths and normalizes JPEG extension", () => {
  const root = "/media/screenshots";
  const jpegKey = keyForMedia(root, join(root, "nested", "guide.JPEG"));
  assert.equal(jpegKey, "nested/guide.jpg");
  assert.equal(keyForMedia(root, join(root, "nested", "guide.jpeg")), jpegKey);
  assert.equal(contentTypeForMedia(".mp4"), "video/mp4");
});

test("uploads stable namespaced paths with no-cache metadata and prints public URL", async () => {
  let request;
  const endpoint = new URL("https://branch.example/s3/");
  const key = "screenshots/nested/a b#c.png";
  const url = await uploadObject({
    endpoint,
    region: "us-east-2",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    key,
    body: Buffer.from("png bytes"),
    contentType: "image/png",
    now: new Date("2026-10-02T00:00:00Z"),
    fetchImpl: async (input) => {
      request = input;
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(request.method, "PUT");
  assert.equal(request.headers.get("content-type"), "image/png");
  assert.equal(request.headers.get("cache-control"), HELP_MEDIA_CACHE_CONTROL);
  assert.equal(
    request.headers.get("x-amz-content-sha256"),
    createHash("sha256").update("png bytes").digest("hex"),
  );
  assert.equal(request.headers.get("x-amz-date"), "20261002T000000Z");
  assert.match(request.headers.get("authorization"), /^AWS4-HMAC-SHA256 /);
  assert.equal(
    request.url,
    `https://branch.example/s3/${HELP_MEDIA_BUCKET}/screenshots/nested/a%20b%23c.png`,
  );
  assert.equal(url, request.url);
  assert.equal(
    publicUrl(endpoint, "file.mp4"),
    `https://branch.example/s3/${HELP_MEDIA_BUCKET}/file.mp4`,
  );
});

test("sends one signed request and preserves HTTP failure details", async () => {
  let calls = 0;
  await assert.rejects(
    uploadObject({
      endpoint: new URL("https://branch.example"),
      region: "us-east-2",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      key: "screenshots/a.png",
      body: Buffer.from("bytes"),
      contentType: "image/png",
      fetchImpl: async (request) => {
        calls += 1;
        assert.ok(request instanceof Request);
        return new Response("storage unavailable", {
          status: 503,
          statusText: "Unavailable",
        });
      },
    }),
    /アップロード失敗 \(503 Unavailable\): storage unavailable/,
  );
  assert.equal(calls, 1);
});

test("fails before upload when credentials are missing or there are no targets", async () => {
  let uploads = 0;
  const validEnvironment = {
    AWS_ENDPOINT_URL_S3: "https://branch.example",
    AWS_REGION: "us-east-2",
    AWS_ACCESS_KEY_ID: "key",
    AWS_SECRET_ACCESS_KEY: "secret",
  };
  await assert.rejects(
    publishHelpMedia({
      environment: {},
      roots: [],
      fetchImpl: async () => {
        uploads += 1;
      },
    }),
    /AWS_ENDPOINT_URL_S3/,
  );
  await assert.rejects(
    publishHelpMedia({
      environment: validEnvironment,
      roots: [],
      fetchImpl: async () => {
        uploads += 1;
      },
    }),
    /公開対象の画像・動画がありません/,
  );
  assert.equal(uploads, 0);
});

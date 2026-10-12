import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HELP_MEDIA_BUCKET,
  listMediaFiles,
  publishHelpMedia,
} from "./publish-help-media.mjs";

test("enumerates image and video files recursively and ignores non-media files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "help-media-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "nested", "guide.PNG"), "image");
    await writeFile(join(directory, "movie.mp4"), "video");
    await writeFile(join(directory, "notes.txt"), "text");
    assert.deepEqual(
      (await listMediaFiles([directory])).map((file) => file.split("/").at(-1)),
      ["movie.mp4", "guide.PNG"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps root order, sorts absolute file paths, skips symlinks, and accepts missing roots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "help-media-order-"));
  const first = join(directory, "first");
  const second = join(directory, "second");
  const linked = join(directory, "linked");
  const missing = join(directory, "missing");
  try {
    await mkdir(join(first, "nested"), { recursive: true });
    await mkdir(second);
    await writeFile(join(first, "z.png"), "first root");
    await writeFile(join(first, "nested", "a.jpg"), "nested");
    await writeFile(join(second, "b.webp"), "second root");
    await mkdir(linked);
    await writeFile(join(linked, "outside.gif"), "linked file");
    await symlink(linked, join(first, "linked"), "dir");

    assert.deepEqual(await listMediaFiles([missing, second, first]), [
      join(second, "b.webp"),
      join(first, "nested", "a.jpg"),
      join(first, "z.png"),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("publishes source-relative screenshot and video keys, preserving overwrite key across bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "help-media-publish-"));
  const screenshots = join(directory, "generated");
  const videos = join(directory, "out");
  await mkdir(join(screenshots, "nested"), { recursive: true });
  await mkdir(join(videos, "nested"), { recursive: true });
  try {
    const image = join(screenshots, "nested", "guide.png");
    const video = join(videos, "nested", "walkthrough.mp4");
    await writeFile(image, "first image");
    await writeFile(video, "video");
    const requests = [];
    const publish = () =>
      publishHelpMedia({
        environment: {
          AWS_ENDPOINT_URL_S3: "https://branch.example/s3",
          AWS_REGION: "us-east-2",
          AWS_ACCESS_KEY_ID: "key",
          AWS_SECRET_ACCESS_KEY: "secret",
        },
        roots: [screenshots, videos],
        output: () => {},
        fetchImpl: async (request) => {
          requests.push({
            input: request.url,
            body: Buffer.from(await request.arrayBuffer()).toString(),
          });
          return new Response(null, { status: 200 });
        },
      });
    await publish();
    await writeFile(image, "changed image bytes");
    await publish();
    const imageUrl = `https://branch.example/s3/${HELP_MEDIA_BUCKET}/screenshots/nested/guide.png`;
    const videoUrl = `https://branch.example/s3/${HELP_MEDIA_BUCKET}/videos/nested/walkthrough.mp4`;
    assert.deepEqual(
      requests.map(({ input }) => input),
      [imageUrl, videoUrl, imageUrl, videoUrl],
    );
    assert.equal(requests[0].body, "first image");
    assert.equal(requests[2].body, "changed image bytes");
    assert.notEqual(requests[0].body, requests[2].body);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

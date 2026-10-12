import { createHash } from "node:crypto";
import { glob, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

// cspell:ignore quicktime
export const HELP_MEDIA_BUCKET = "time-card-help";
export const HELP_MEDIA_CACHE_CONTROL = "public, no-cache";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../..");
export const HELP_MEDIA_ROOTS = [
  join(REPOSITORY_ROOT, "apps/help/public/images/generated"),
  join(REPOSITORY_ROOT, "tools/tutorial-video/out"),
];
const EXTENSION_TYPES = new Map([
  [".png", [".png", "image/png"]],
  [".jpg", [".jpg", "image/jpeg"]],
  [".jpeg", [".jpg", "image/jpeg"]],
  [".webp", [".webp", "image/webp"]],
  [".gif", [".gif", "image/gif"]],
  [".svg", [".svg", "image/svg+xml"]],
  [".mp4", [".mp4", "video/mp4"]],
  [".webm", [".webm", "video/webm"]],
  [".mov", [".mov", "video/quicktime"]],
]);

export function keyForMedia(root, file) {
  const path = relative(root, file);
  if (!path || path.startsWith(`..${sep}`) || path === "..")
    throw new Error("メディアファイルは公開対象 root の配下にしてください");
  const normalizedPath = path.split(sep).join("/");
  const extension = extname(normalizedPath).toLowerCase();
  const mediaType = EXTENSION_TYPES.get(extension.toLowerCase());
  if (!mediaType)
    throw new Error(`対応していないメディア拡張子です: ${extension}`);
  const [normalizedExtension] = mediaType;
  const stem = normalizedPath.slice(0, -extension.length);
  return `${stem}${normalizedExtension}`;
}

export function contentTypeForMedia(extension) {
  const mediaType = EXTENSION_TYPES.get(extension.toLowerCase());
  if (!mediaType)
    throw new Error(`対応していないメディア拡張子です: ${extension}`);
  return mediaType[1];
}

export async function listMediaFiles(roots = HELP_MEDIA_ROOTS) {
  const files = [];
  for (const root of roots) {
    const absoluteRoot = resolve(root);
    const rootFiles = [];
    for await (const entry of glob("**/*", {
      cwd: absoluteRoot,
      exclude: (entry) => entry.isSymbolicLink(),
      followSymlinks: false,
      withFileTypes: true,
    })) {
      if (
        entry.isFile() &&
        EXTENSION_TYPES.has(extname(entry.name).toLowerCase())
      ) {
        rootFiles.push(resolve(entry.parentPath, entry.name));
      }
    }
    rootFiles.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    files.push(...rootFiles);
  }
  return files;
}

function requiredEnvironment(environment) {
  const names = [
    "AWS_ENDPOINT_URL_S3",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];
  const missing = names.filter((name) => !environment[name]?.trim());
  if (missing.length)
    throw new Error(`必要な環境変数がありません: ${missing.join(", ")}`);
  let endpoint;
  try {
    endpoint = new URL(environment.AWS_ENDPOINT_URL_S3);
  } catch {
    throw new Error("AWS_ENDPOINT_URL_S3 は有効な URL にしてください");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error(
      "AWS_ENDPOINT_URL_S3 は http または https の URL にしてください",
    );
  }
  if (endpoint.search || endpoint.hash)
    throw new Error("AWS_ENDPOINT_URL_S3 に query/hash は指定できません");
  return {
    endpoint,
    region: environment.AWS_REGION,
    accessKeyId: environment.AWS_ACCESS_KEY_ID,
    secretAccessKey: environment.AWS_SECRET_ACCESS_KEY,
  };
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeKeyPath(key) {
  return key.split("/").map(awsEncode).join("/");
}

function objectPath(endpoint, key) {
  const basePath = endpoint.pathname.replace(/\/$/, "");
  return `${basePath}/${HELP_MEDIA_BUCKET}/${encodeKeyPath(key)}`;
}

export function publicUrl(endpoint, key) {
  const base = endpoint instanceof URL ? new URL(endpoint) : new URL(endpoint);
  base.pathname = objectPath(base, key);
  base.search = "";
  base.hash = "";
  return base.toString();
}

export async function uploadObject({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  key,
  body,
  contentType,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalUri = objectPath(endpoint, key);
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region,
    service: "s3",
    retries: 0,
  });
  const request = await client.sign(new URL(canonicalUri, endpoint), {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "cache-control": HELP_MEDIA_CACHE_CONTROL,
      "x-amz-content-sha256": payloadHash,
    },
    body,
    aws: { datetime: date, allHeaders: true },
  });
  // Use sign() and the injected fetch directly so this one upload cannot be retried.
  const response = await fetchImpl(request);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `アップロード失敗 (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`,
    );
  }
  return publicUrl(endpoint, key);
}

export async function publishHelpMedia({
  environment = process.env,
  roots = HELP_MEDIA_ROOTS,
  fetchImpl = fetch,
  output = console.log,
} = {}) {
  const config = requiredEnvironment(environment);
  const files = await listMediaFiles(roots);
  if (files.length === 0)
    throw new Error(
      "公開対象の画像・動画がありません。先にメディア生成コマンドを実行してください",
    );
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    const body = await readFile(file);
    const root = roots.find((candidate) => {
      const path = relative(candidate, file);
      return path && !path.startsWith(`..${sep}`) && path !== "..";
    });
    const namespace = roots.indexOf(root) === 0 ? "screenshots" : "videos";
    const key = `${namespace}/${keyForMedia(root, file)}`;
    let url;
    try {
      url = await uploadObject({
        ...config,
        key,
        body,
        contentType: contentTypeForMedia(extension),
        fetchImpl,
      });
    } catch (error) {
      throw new Error(`${file} の公開に失敗しました: ${error.message}`, {
        cause: error,
      });
    }
    output(`${key}\t${url}`);
  }
  return files.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  publishHelpMedia().catch((error) => {
    console.error(
      `利用者ガイド用メディアを公開できませんでした: ${error.message}`,
    );
    process.exitCode = 1;
  });
}

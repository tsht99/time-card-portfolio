const mediaNamePatterns = {
  screenshots: /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/,
  videos: /^[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/,
} as const;

function isValidBase(base: string): boolean {
  if (!base || /\s/.test(base) || base.includes("\\")) return false;

  if (base.startsWith("/")) {
    if (base.startsWith("//") || /[?#]|%(?:2f|5c)/i.test(base)) return false;
    try {
      const decoded = decodeURIComponent(base);
      return decoded.split("/").every((part) => part !== "." && part !== "..");
    } catch {
      return false;
    }
  }

  try {
    if (/[?#]/.test(base)) return false;
    const url = new URL(base);
    const rawPath = base.match(/^https?:\/\/[^/]*(\/[^?#]*)?/i)?.[1] ?? "/";
    const decodedPath = decodeURIComponent(rawPath);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !decodedPath.split("/").some((part) => part === "." || part === "..")
    );
  } catch {
    return false;
  }
}

export function resolveHelpMediaUrl(
  namespace: keyof typeof mediaNamePatterns,
  name: string,
  base: string | undefined,
): string | null {
  if (!base || base !== base.trim()) return null;
  const normalizedBase = base.replace(/\/+$/, "");
  if (
    !mediaNamePatterns[namespace].test(name) ||
    !normalizedBase ||
    !isValidBase(normalizedBase)
  ) {
    return null;
  }
  return `${normalizedBase}/${name}`;
}

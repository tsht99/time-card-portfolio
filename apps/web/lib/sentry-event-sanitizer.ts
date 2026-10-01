import type { Breadcrumb, Event } from "@sentry/nextjs";

const relativeUrlBase = "http://sentry.invalid";
const urlSchemePattern = /^[a-z][a-z\d+.-]*:/i;

export function sanitizeSentryEvent<T extends Event>(event: T): T {
  delete event.request;
  delete event.user;

  if (event.breadcrumbs?.some(isHttpBreadcrumb)) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) =>
      isHttpBreadcrumb(breadcrumb)
        ? sanitizeHttpBreadcrumb(breadcrumb)
        : breadcrumb,
    );
  }

  return event;
}

function isHttpBreadcrumb(breadcrumb: Breadcrumb): boolean {
  return breadcrumb.type === "http" || breadcrumb.category === "http";
}

function sanitizeHttpBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = isRecord(breadcrumb.data) ? breadcrumb.data : undefined;
  const sanitizedData: Record<string, unknown> = {};

  if (data && typeof data["http.request.method"] === "string") {
    sanitizedData["http.request.method"] = data["http.request.method"];
  }

  if (
    data &&
    typeof data.status_code === "number" &&
    Number.isFinite(data.status_code)
  ) {
    sanitizedData.status_code = data.status_code;
  }

  const sanitizedUrl = sanitizeHttpBreadcrumbUrl(data?.url);
  if (sanitizedUrl !== undefined) {
    sanitizedData.url = sanitizedUrl;
  }

  const breadcrumbWithoutData = { ...breadcrumb };
  delete breadcrumbWithoutData.data;
  return Object.keys(sanitizedData).length > 0
    ? { ...breadcrumbWithoutData, data: sanitizedData }
    : breadcrumbWithoutData;
}

function sanitizeHttpBreadcrumbUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const isAbsoluteUrl = urlSchemePattern.test(value);
  const isProtocolRelativeUrl = value.startsWith("//");

  try {
    const parsedUrl = new URL(value, relativeUrlBase);
    parsedUrl.search = "";
    parsedUrl.hash = "";
    parsedUrl.username = "";
    parsedUrl.password = "";

    if (isAbsoluteUrl) {
      return parsedUrl.toString();
    }

    if (isProtocolRelativeUrl) {
      return `//${parsedUrl.host}${parsedUrl.pathname}`;
    }

    return parsedUrl.pathname;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

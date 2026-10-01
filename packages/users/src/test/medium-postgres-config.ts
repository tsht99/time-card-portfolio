import { randomUUID } from "node:crypto";

export const EXTERNAL_POSTGRES_URL_ENV =
  "TIME_CARD_TEST_POSTGRES_MAINTENANCE_URL";
export const MEDIUM_TEMPLATE_DATABASE = "timecard_medium_template";
export const MEDIUM_TEMPLATE_URL_ENV = "TIME_CARD_MEDIUM_POSTGRES_TEMPLATE_URL";

export function createMediumTemplateDatabaseName(): string {
  return `${MEDIUM_TEMPLATE_DATABASE}_${process.pid}_${randomUUID().replaceAll("-", "")}`;
}

export function parseExternalMaintenanceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must be a valid PostgreSQL URL`,
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:")) {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must use postgres or postgresql`,
    );
  }
  if (
    !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    )
  ) {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must target a localhost loopback address`,
    );
  }
  if (url.pathname !== "/postgres") {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must connect to the postgres maintenance database`,
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(
      `${EXTERNAL_POSTGRES_URL_ENV} must not include query parameters or a fragment`,
    );
  }
  return url;
}

export function databaseUrl(
  baseUrl: string | URL,
  databaseName: string,
): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function quoteDatabaseIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function assertPostgres18Version(serverVersionNum: string): void {
  if (!serverVersionNum.startsWith("18")) {
    throw new Error("External test PostgreSQL server must be major version 18");
  }
}

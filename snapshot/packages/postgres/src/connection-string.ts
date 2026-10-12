const TLS_MODES_TO_UPGRADE = new Set(["prefer", "require", "verify-ca"]);

export function normalizePostgresConnectionString(
  connectionString: string,
): string {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get("sslmode");

  if (!sslmode || !TLS_MODES_TO_UPGRADE.has(sslmode)) {
    return connectionString;
  }

  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

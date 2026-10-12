export const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function isAllowedSpecifier(specifier) {
  return (
    specifier === "workspace:*" ||
    specifier === "catalog:" ||
    /^catalog:[A-Za-z0-9_-]+$/u.test(specifier)
  );
}

export function isExactDependencySpecifier(specifier) {
  return isAllowedSpecifier(specifier) || exactVersionPattern.test(specifier);
}

export function parseCatalogEntries(yaml) {
  const entries = [];
  let section = null;
  let catalogName = null;

  for (const [index, rawLine] of yaml.split(/\r?\n/u).entries()) {
    if (!rawLine.trim() || /^\s*#/u.test(rawLine)) continue;
    const topLevel = /^(catalog|catalogs):\s*(?:#.*)?$/u.exec(rawLine);
    if (topLevel) {
      section = topLevel[1];
      catalogName = null;
      continue;
    }
    if (section === null) continue;

    const indent = rawLine.match(/^ */u)[0].length;
    const entryLine = rawLine.trim();
    if (section === "catalogs" && indent === 2) {
      const namedCatalog = /^([\w-]+):\s*(?:#.*)?$/u.exec(entryLine);
      if (!namedCatalog) {
        throw new Error(
          `Unable to parse pnpm-workspace.yaml named catalog on line ${index + 1}: ${entryLine}`,
        );
      }
      catalogName = namedCatalog[1];
      continue;
    }
    const expectedIndent = section === "catalog" ? 2 : 4;
    if (indent !== expectedIndent) {
      if (indent < expectedIndent) section = null;
      continue;
    }
    const match =
      /^(?:'((?:[^']|'')+)'|"([^"]+)"|([^:#][^:]*)):\s*(\S+)\s*(?:#.*)?$/u.exec(
        entryLine,
      );
    if (!match) {
      if (/^[^#][^:]*:\s*/u.test(entryLine)) {
        throw new Error(
          `Unable to parse pnpm-workspace.yaml catalog entry on line ${index + 1}: ${entryLine}`,
        );
      }
      continue;
    }
    const name = (match[1] ?? match[2] ?? match[3])
      .replaceAll("''", "'")
      .trim();
    entries.push({
      name,
      specifier: match[4],
      location: catalogName ? `catalogs.${catalogName}` : "catalog",
      line: index + 1,
    });
  }
  return entries;
}

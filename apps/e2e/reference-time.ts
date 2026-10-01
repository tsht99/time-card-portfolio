import type { Page } from "@playwright/test";

const TOKYO_TIME_ZONE = "Asia/Tokyo";

export const E2E_REFERENCE_TIME_ISO = "2026-01-01T03:00:00.000Z";

function getTokyoDateParts(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== "literal") parts[part.type] = part.value;
      return parts;
    }, {});
}

export function e2eTokyoDateAt(daysFromReference: number, time: string): Date {
  const referenceDateParts = getTokyoDateParts(
    new Date(E2E_REFERENCE_TIME_ISO),
  );
  const shiftedDate = new Date(
    `${referenceDateParts.year}-${referenceDateParts.month}-${referenceDateParts.day}T12:00:00+09:00`,
  );
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + daysFromReference);

  const year = shiftedDate.getUTCFullYear();
  const month = String(shiftedDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shiftedDate.getUTCDate()).padStart(2, "0");
  return new Date(`${year}-${month}-${day}T${time}:00+09:00`);
}

export async function setE2eBrowserReferenceTime(page: Page): Promise<void> {
  await page.clock.setFixedTime(E2E_REFERENCE_TIME_ISO);
}

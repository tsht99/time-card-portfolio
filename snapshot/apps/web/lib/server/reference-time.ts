import "server-only";

export function getServerReferenceTime(): Date {
  const runtime = process.env.WEB_TEST_RUNTIME;
  const fixedNow = process.env.TIMECARD_TEST_FIXED_NOW;

  if (
    (runtime !== "production" && runtime !== "development") ||
    fixedNow === undefined ||
    fixedNow === ""
  ) {
    return new Date();
  }

  const referenceTime = new Date(fixedNow);
  if (Number.isNaN(referenceTime.getTime())) {
    throw new Error("TIMECARD_TEST_FIXED_NOW must be a valid date.");
  }
  return referenceTime;
}

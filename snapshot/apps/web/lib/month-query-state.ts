import { createParser, createSerializer } from "nuqs/server";
import { isValidMonth } from "./month";

export const monthParser = createParser({
  parse: (value) => (isValidMonth(value) ? value : null),
  serialize: (value: string) => value,
});

export const serializeMonthQuery = createSerializer({ month: monthParser });

export const payrollDetailMonthParser = monthParser.withOptions({
  history: "push",
  shallow: false,
  scroll: true,
});

export function parseMonthQuery(value: string | string[] | undefined) {
  // Keep raw cardinality validation outside nuqs: repeated values are invalid
  // input even when one of them is a valid month.
  if (typeof value !== "string") return null;
  return monthParser.parse(value);
}

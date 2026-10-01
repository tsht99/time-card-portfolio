import { deepStrictEqual } from "node:assert";
import test from "node:test";
import { filterAttendanceList } from "./attendance-query.ts";

test("status filtering is applied after attendance summaries are created", () => {
  const items = [
    { status: "working" as const, userId: "one" },
    { status: "completed" as const, userId: "two" },
  ];

  deepStrictEqual(filterAttendanceList(items, "completed"), [items[1]]);
  deepStrictEqual(filterAttendanceList(items, undefined), items);
  deepStrictEqual(filterAttendanceList([], "completed"), []);
});

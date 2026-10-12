import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQueryState } from "nuqs";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { createElement } from "react";
import { describe, expect, test } from "vitest";
import { parseMonthQuery, payrollDetailMonthParser } from "./month-query-state";

function PayrollDetailMonthQueryProbe() {
  const [, setMonth] = useQueryState("month", payrollDetailMonthParser);
  return createElement(
    "button",
    { type: "button", onClick: () => void setMonth("2026-08") },
    "Change month",
  );
}

describe("month query state", () => {
  test("parses one valid month", () => {
    expect(parseMonthQuery("2026-09")).toBe("2026-09");
  });

  test.each([undefined, ["2026-09"], ["2026-09", "2026-08"], "2026-13"])(
    "rejects invalid or repeated month input: %j",
    (value) => {
      expect(parseMonthQuery(value)).toBeNull();
    },
  );

  test("payroll detail pushes the month, notifies the server, and scrolls to top", async () => {
    let update:
      | {
          queryString: string;
          options: { history: string; shallow: boolean; scroll: boolean };
        }
      | undefined;
    render(createElement(PayrollDetailMonthQueryProbe), {
      wrapper: withNuqsTestingAdapter({
        searchParams: "",
        onUrlUpdate: (event) => {
          update = event;
        },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Change month" }));
    await waitFor(() => expect(update).toBeDefined());
    expect(update?.queryString).toContain("month=2026-08");
    expect(update?.options).toMatchObject({
      history: "push",
      shallow: false,
      scroll: true,
    });
  });
});

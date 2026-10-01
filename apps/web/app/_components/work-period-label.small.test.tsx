import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";

test("昼の勤務区分を「昼」と表示する", () => {
  render(<WorkPeriodLabel workPeriod="day" />);
  expect(screen.getByText("昼")).toBeTruthy();
});

test("夜の勤務区分を「夜」と表示する", () => {
  render(<WorkPeriodLabel workPeriod="night" />);
  expect(screen.getByText("夜")).toBeTruthy();
});

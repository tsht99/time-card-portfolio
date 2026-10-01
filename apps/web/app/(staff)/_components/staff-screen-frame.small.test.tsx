import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StaffScreenFrame } from "./staff-screen-frame.tsx";

describe("StaffScreenFrame", () => {
  test.each([
    ["clock", "打刻", "履歴"],
    ["history", "履歴", "打刻"],
  ] as const)(
    "%s active state renders both navigation links with the selected page marked",
    (active, selectedLabel, unselectedLabel) => {
      render(
        <StaffScreenFrame active={active}>
          <div>コンテンツ</div>
        </StaffScreenFrame>,
      );

      expect(
        screen.getByRole("link", { name: "打刻" }).getAttribute("href"),
      ).toBe("/clock");
      expect(
        screen.getByRole("link", { name: "履歴" }).getAttribute("href"),
      ).toBe("/history");
      expect(
        screen
          .getByRole("link", { name: selectedLabel })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(
        screen
          .getByRole("link", { name: unselectedLabel })
          .hasAttribute("aria-current"),
      ).toBe(false);
      expect(
        screen.getByRole("navigation", { name: "勤怠画面の切り替え" }),
      ).toBeTruthy();
      expect(screen.getByText("コンテンツ")).toBeTruthy();
    },
  );
});

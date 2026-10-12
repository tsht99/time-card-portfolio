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
      const guide = screen.getByRole("link", { name: "利用者ガイド ↗" });
      const content = screen.getByText("コンテンツ");
      const surface = content.closest(".border-zinc-300.bg-surface");
      expect(surface).not.toBeNull();
      expect(surface?.classList.contains("flex")).toBe(true);
      expect(surface?.classList.contains("flex-col")).toBe(true);
      expect(surface?.contains(guide)).toBe(true);
      expect(guide.classList.contains("mt-auto")).toBe(true);
      expect(guide.getAttribute("target")).toBe("_blank");
      expect(guide.getAttribute("rel")).toBe("noopener noreferrer");
      expect(guide.getAttribute("href")).toBe(
        `https://help.example.test${active === "clock" ? "/staff" : "/staff/history"}`,
      );
    },
  );
});

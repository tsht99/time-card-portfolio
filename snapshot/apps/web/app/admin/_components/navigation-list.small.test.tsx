import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { NavigationList, NavigationListItem } from "./navigation-list.tsx";

describe("NavigationList", () => {
  test("各行の内容と遷移アイコンを含むリンクを semantic なリストに表示する", () => {
    render(
      <NavigationList aria-label="スタッフ一覧">
        <NavigationListItem href="/admin/users/123" aria-label="スタッフ詳細">
          <span>スタッフ名</span>
        </NavigationListItem>
      </NavigationList>,
    );

    const list = screen.getByRole("list", { name: "スタッフ一覧" });
    const item = within(list).getByRole("listitem");
    const link = within(item).getByRole("link", { name: "スタッフ詳細" });
    expect(link.getAttribute("href")).toBe("/admin/users/123");
    expect(link.contains(screen.getByText("スタッフ名"))).toBe(true);
    expect(link.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });
});

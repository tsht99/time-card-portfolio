import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { NavigationCard } from "./navigation-card.tsx";

describe("NavigationCard", () => {
  test("子要素を含む行全体を指定先へのリンクとして表示する", () => {
    render(
      <NavigationCard href="/admin/users/123">
        <span>スタッフ名</span>
      </NavigationCard>,
    );

    const link = screen.getByRole("link", { name: "スタッフ名" });
    expect(link.getAttribute("href")).toBe("/admin/users/123");
    expect(link.contains(screen.getByText("スタッフ名"))).toBe(true);
  });

  test("aria-labelをリンクのアクセシブルな名前に渡す", () => {
    render(
      <NavigationCard href="/admin/users/123" aria-label="スタッフ詳細">
        スタッフ名
      </NavigationCard>,
    );

    expect(screen.getByRole("link", { name: "スタッフ詳細" })).not.toBeNull();
  });
});

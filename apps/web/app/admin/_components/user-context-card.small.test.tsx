import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { UserContextCard } from "./user-context-card.tsx";

afterEach(() => cleanup());

describe("UserContextCard", () => {
  test("表示名と未設定時の文言を表示し、ユーザーアイコンを装飾扱いにする", () => {
    const { rerender } = render(<UserContextCard displayName="山田 太郎" />);
    expect(screen.getByText("山田 太郎")).toBeTruthy();
    expect(screen.getByLabelText("対象ユーザー")).toBeTruthy();
    expect(
      screen
        .getByLabelText("対象ユーザー")
        .querySelector("svg")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");

    rerender(<UserContextCard displayName={null} />);
    expect(screen.getByText("名前未設定")).toBeTruthy();
  });

  test("閲覧専用では編集ボタンを表示せず、編集可能なら callback を呼ぶ", () => {
    const onEditDisplayName = vi.fn();
    const { rerender } = render(<UserContextCard displayName="山田 太郎" />);
    expect(screen.queryByRole("button", { name: "表示名を編集" })).toBeNull();

    rerender(
      <UserContextCard
        displayName="山田 太郎"
        onEditDisplayName={onEditDisplayName}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "表示名を編集" }));
    expect(onEditDisplayName).toHaveBeenCalledTimes(1);
  });

  test("編集操作を disabled にできる", () => {
    render(
      <UserContextCard
        displayName="山田 太郎"
        onEditDisplayName={vi.fn()}
        editDisabled
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "表示名を編集" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});

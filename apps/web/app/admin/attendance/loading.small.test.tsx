import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Loading from "./loading";

test("勤怠一覧の読み込み状態を明示し、ページ見出しを重複表示しない", () => {
  render(<Loading />);

  const loadingRegion = screen.getByRole("region", { name: "勤怠一覧" });
  expect(loadingRegion.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("status").textContent).toContain(
    "勤怠一覧を読み込み中",
  );
  expect(screen.queryByRole("heading", { name: "勤怠履歴" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "勤怠一覧" })).toBeNull();
  expect(screen.queryByRole("list", { name: "勤怠一覧" })).toBeNull();
  expect(screen.queryByText("この期間の勤怠はありません。")).toBeNull();
});

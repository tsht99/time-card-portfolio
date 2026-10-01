import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));

import GlobalError from "./global-error";

afterEach(() => {
  cleanup();
  mocks.captureException.mockReset();
});

test("利用者向けのエラー表示から再試行でき、詳細は表示せず Sentry に報告する", async () => {
  const error = Object.assign(new Error("private message: secret-message"), {
    digest: "secret-digest",
    stack: "private stack: secret-stack",
  });
  const retry = vi.fn();

  render(<GlobalError error={error} unstable_retry={retry} />, {
    container: document,
    baseElement: document,
  });

  expect(
    screen.getByRole("heading", { name: "エラーが発生しました" }),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "予期しない問題が発生しました。時間をおいて、もう一度お試しください。",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
  expect(retry).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(mocks.captureException).toHaveBeenCalledWith(error);
  });

  expect(document.body.textContent).not.toContain("secret-message");
  expect(document.body.textContent).not.toContain("secret-stack");
  expect(document.body.textContent).not.toContain("secret-digest");
});

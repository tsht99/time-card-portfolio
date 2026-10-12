import { expect, test, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect }));

test("/admin は勤怠画面へ redirect する", async () => {
  const { default: Home } = await import("./page");

  expect(() => Home()).toThrow("redirect: /admin/attendance");
  expect(redirect).toHaveBeenCalledWith("/admin/attendance");
});

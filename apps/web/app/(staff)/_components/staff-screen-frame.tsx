import Link from "next/link";
import type { ReactNode } from "react";

export function StaffScreenFrame({
  active,
  children,
}: {
  active: "clock" | "history";
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[448px] flex-1 flex-col">
      <nav
        aria-label="勤怠画面の切り替え"
        className="-mb-px flex min-w-0 items-start"
      >
        <Link
          href="/clock"
          aria-current={active === "clock" ? "page" : undefined}
          className={`min-w-0 flex-1 rounded-t-none border px-4 py-3 text-center text-sm font-medium ${active === "clock" ? "relative z-10 -mb-px border-zinc-300 border-b-surface bg-surface text-zinc-950" : "border-zinc-200 bg-zinc-300 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-950"}`}
        >
          打刻
        </Link>
        <Link
          href="/history"
          aria-current={active === "history" ? "page" : undefined}
          className={`min-w-0 flex-1 rounded-t-none border px-4 py-3 text-center text-sm font-medium ${active === "history" ? "relative z-10 -mb-px border-zinc-300 border-b-surface bg-surface text-zinc-950" : "border-zinc-200 bg-zinc-300 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-950"}`}
        >
          履歴
        </Link>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col rounded-b-none border border-zinc-300 bg-surface p-4">
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
      </div>
    </div>
  );
}

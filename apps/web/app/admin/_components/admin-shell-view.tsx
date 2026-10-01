"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  adminNavigationItems,
  getActiveAdminNavigationHref,
  getAdminPageTitle,
} from "../_lib/admin-shell-navigation.ts";

export function AdminShellView({
  pathname,
  isAuthReady,
  children,
}: {
  pathname: string;
  isAuthReady: boolean;
  children: ReactNode;
}) {
  const activeNavigationHref = getActiveAdminNavigationHref(pathname);
  const pageTitle = getAdminPageTitle(pathname);
  return (
    <div className="flex min-h-dvh min-w-0 flex-1 flex-col px-0 py-0 text-zinc-950">
      <div className="relative mx-auto flex min-h-0 w-full min-w-0 max-w-[448px] flex-1 flex-col">
        {isAuthReady && (
          <nav
            aria-label="管理画面のメインナビゲーション"
            className="-mb-px flex min-w-0 items-start"
          >
            {adminNavigationItems.map((item) => {
              const isActive = activeNavigationHref === item.href;
              const className = `block min-w-0 flex-1 border px-2 py-3 text-center text-sm font-medium ${isActive ? "relative z-10 -mb-px border-zinc-300 border-b-surface bg-surface text-zinc-950" : "border-zinc-200 bg-zinc-300 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-950"}`;
              return isActive ? (
                <span key={item.href} aria-current="page" className={className}>
                  {item.label}
                </span>
              ) : (
                <Link key={item.href} href={item.href} className={className}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
        {isAuthReady && (
          <header className="flex min-h-16 min-w-0 items-center rounded-t-none border border-zinc-300 bg-surface px-4 py-3">
            <h1 className="min-w-0 truncate text-lg font-semibold text-zinc-950">
              {pageTitle}
            </h1>
          </header>
        )}
        <div
          className={`min-h-0 min-w-0 flex-1 border border-zinc-300 bg-surface ${isAuthReady ? "rounded-b-none border-t-0" : "rounded-none"}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

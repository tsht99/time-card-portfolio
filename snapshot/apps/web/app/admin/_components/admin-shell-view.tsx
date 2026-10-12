"use client";

import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import Link from "next/link";
import type { ReactNode } from "react";
import { UserGuideLink } from "../../_components/user-guide-link";
import {
  adminNavigationItems,
  getActiveAdminNavigationHref,
  getAdminPageTitle,
} from "../_lib/admin-shell-navigation.ts";

export function AdminShellView({
  pathname,
  isAuthReady,
  authMessage,
  reloadRequired = false,
  onReload,
  contentKey,
  children,
}: {
  pathname: string;
  isAuthReady: boolean;
  authMessage?: string;
  reloadRequired?: boolean;
  onReload?: () => void;
  contentKey?: string;
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
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={className}
                >
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
          className={`flex min-h-0 min-w-0 flex-1 flex-col border border-zinc-300 bg-surface ${isAuthReady ? "rounded-b-none border-t-0" : "rounded-none"}`}
        >
          {!isAuthReady && authMessage && (
            <div className="px-4 py-6 text-sm text-zinc-700">
              {!reloadRequired && <p role="status">{authMessage}</p>}
              {reloadRequired && (
                <div className="mt-2">
                  <Alert variant="destructive">
                    <AlertDescription className="space-y-1">
                      <p>最新のデータを取得できませんでした。</p>
                      <p>ページを再読み込みしてください。</p>
                      <p>
                        再読み込みすると、未保存の入力内容が失われる可能性があります。
                      </p>
                    </AlertDescription>
                  </Alert>
                  <Button type="button" onClick={onReload} className="mt-4">
                    ページを再読み込み
                  </Button>
                </div>
              )}
            </div>
          )}
          <div
            key={contentKey}
            hidden={!isAuthReady}
            aria-hidden={!isAuthReady}
          >
            {children}
          </div>
          {isAuthReady && (
            <aside aria-label="関連情報" className="mt-auto px-4 pb-4">
              <UserGuideLink pathname={pathname} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShellView } from "./admin-shell-view";
import { useAuth } from "./auth-provider.tsx";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { authState, serverSubjectUserId, isSubjectCurrent, refreshFailure } =
    useAuth();
  const authMessage =
    refreshFailure?.message ??
    (authState.status === "ready"
      ? "認証状態を更新しています..."
      : authState.message);
  return (
    <AdminShellView
      pathname={pathname}
      isAuthReady={isSubjectCurrent && refreshFailure === null}
      authMessage={authMessage}
      reloadRequired={refreshFailure !== null}
      onReload={() => window.location.reload()}
      contentKey={serverSubjectUserId ?? "unresolved"}
    >
      {children}
    </AdminShellView>
  );
}

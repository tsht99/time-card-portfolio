"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShellView } from "./admin-shell-view";
import { useAuth } from "./auth-provider.tsx";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { authState } = useAuth();
  return (
    <AdminShellView
      pathname={pathname}
      isAuthReady={authState.status === "ready"}
    >
      {children}
    </AdminShellView>
  );
}

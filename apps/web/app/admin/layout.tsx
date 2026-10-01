import type { Metadata } from "next";
import type { ReactNode } from "react";
import { resolveAdminAuthSession } from "../../lib/server/auth-session";
import { AdminShell } from "./_components/admin-shell.tsx";
import { AuthProvider } from "./_components/auth-provider.tsx";
import { QueryProvider } from "./_components/query-provider.tsx";

export const metadata: Metadata = {
  title: "TimeCard 管理画面",
  description: "TimeCardの管理画面",
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const initialAuth = await resolveAdminAuthSession();
  return (
    <QueryProvider>
      <AuthProvider initialAuth={initialAuth}>
        <AdminShell>{children}</AdminShell>
      </AuthProvider>
    </QueryProvider>
  );
}

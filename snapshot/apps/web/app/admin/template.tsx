import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { resolveAdminAuthSession } from "../../lib/server/auth-session";
import { AdminShell } from "./_components/admin-shell.tsx";
import { AuthProvider } from "./_components/auth-provider.tsx";

export function getAdminAuthScopeKey(
  auth: Awaited<ReturnType<typeof resolveAdminAuthSession>>,
) {
  switch (auth.status) {
    case "ready":
      return `ready:${auth.user.userId}`;
    case "unavailable":
      return `unavailable:${auth.code}:${auth.message}`;
    case "error":
      return `error:${auth.message}`;
    case "missing":
      return auth.status;
  }
}

export default async function AdminTemplate({
  children,
}: {
  children: ReactNode;
}) {
  const initialAuth = await resolveAdminAuthSession();
  const serverRenderId = randomUUID();
  const authScopeKey = getAdminAuthScopeKey(initialAuth);

  return (
    <AuthProvider
      key={authScopeKey}
      initialAuth={initialAuth}
      serverRenderId={serverRenderId}
      diagnostics={process.env.WEB_TEST_RUNTIME !== undefined}
    >
      <AdminShell>{children}</AdminShell>
    </AuthProvider>
  );
}

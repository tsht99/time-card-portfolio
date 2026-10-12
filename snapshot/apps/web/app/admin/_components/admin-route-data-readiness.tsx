"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { useAuth } from "./auth-provider.tsx";

export function AdminRouteDataReadiness({
  routeDataToken,
  ready,
  children,
}: {
  routeDataToken: string;
  ready: boolean;
  children: ReactNode;
}) {
  const { reportRouteDataReadiness, serverRenderId, diagnostics } = useAuth();
  const pathname = usePathname();
  const diagnosticRef = useRef<HTMLSpanElement>(null);
  const previousReportRef = useRef<{
    routeDataToken: string;
    routeLocation: string;
  } | null>(null);
  useLayoutEffect(() => {
    const previousReport = previousReportRef.current;
    const routeLocation = `${pathname}${window.location.search}`;
    if (
      previousReport?.routeDataToken === routeDataToken &&
      previousReport.routeLocation === routeLocation
    )
      return;
    const payloadMatchesCurrentRoute =
      previousReport?.routeDataToken !== routeDataToken;
    previousReportRef.current = { routeDataToken, routeLocation };
    reportRouteDataReadiness(
      routeDataToken,
      routeLocation,
      ready && payloadMatchesCurrentRoute,
    );
    if (diagnosticRef.current) {
      diagnosticRef.current.dataset.reported = "true";
      diagnosticRef.current.dataset.reportedRouteLocation = routeLocation;
    }
  }, [pathname, ready, reportRouteDataReadiness, routeDataToken]);
  return (
    <>
      {diagnostics && (
        <span
          key={`${pathname}:${routeDataToken}`}
          ref={diagnosticRef}
          hidden
          data-testid="admin-route-readiness-diagnostic"
          data-provider-render-id={serverRenderId}
          data-route-data-token={routeDataToken}
          data-route-location={pathname}
          data-ready={String(ready)}
          data-reported="false"
        />
      )}
      {children}
    </>
  );
}

function getUserGuidePath(pathname: string): string {
  if (pathname === "/clock") return "/staff";
  if (pathname === "/history") return "/staff/history";
  if (pathname.startsWith("/admin/attendance/")) {
    if (pathname === "/admin/attendance/new") return "/admin/create-attendance";
    if (/^\/admin\/attendance\/[^/]+\/edit$/.test(pathname)) {
      return "/admin/correct-or-cancel-attendance";
    }
    return "/admin/attendance";
  }
  if (pathname === "/admin/attendance") return "/admin/attendance";
  if (
    pathname === "/admin/payroll-estimates" ||
    /^\/admin\/users\/[^/]+\/payroll-estimates$/.test(pathname)
  ) {
    return "/admin/payroll-estimate";
  }
  if (pathname === "/admin/users" || /^\/admin\/users\/[^/]+$/.test(pathname)) {
    return "/admin/users";
  }
  if (
    /^\/admin\/users\/[^/]+\/hourly-wage-rules(?:\/history)?$/.test(pathname)
  ) {
    return "/admin/hourly-wages";
  }
  return pathname.startsWith("/admin") ? "/admin" : "/staff";
}

export function getUserGuideUrl(baseUrl: string, pathname: string): string {
  const base = new URL(baseUrl);
  const path = getUserGuidePath(pathname);
  return `${base.origin}${base.pathname.replace(/\/+$/, "")}${path}`;
}

export const adminNavigationItems = [
  { href: "/admin/attendance", label: "勤怠" },
  { href: "/admin/payroll-estimates", label: "給与見込み" },
  { href: "/admin/users", label: "ユーザー" },
] as const;

const adminPageTitles = new Map<string, string>([
  ["/admin/attendance", "勤怠一覧"],
  ["/admin/attendance/new", "勤怠作成"],
  ["/admin/payroll-estimates", "給与見込み一覧"],
  ["/admin/users", "ユーザー一覧"],
]);

export function getAdminPageTitle(pathname: string) {
  const exactTitle = adminPageTitles.get(pathname);
  if (exactTitle) return exactTitle;

  if (/^\/admin\/attendance\/[^/]+\/edit$/.test(pathname)) {
    return "勤怠訂正";
  }
  if (/^\/admin\/attendance\/[^/]+$/.test(pathname)) {
    return "勤怠詳細";
  }
  if (/^\/admin\/users\/[^/]+\/payroll-estimates$/.test(pathname)) {
    return "給与見込み詳細";
  }
  if (/^\/admin\/users\/[^/]+\/hourly-wage-rules\/history$/.test(pathname)) {
    return "時給履歴";
  }
  if (/^\/admin\/users\/[^/]+\/hourly-wage-rules$/.test(pathname)) {
    return "時給設定";
  }
  if (/^\/admin\/users\/[^/]+$/.test(pathname)) {
    return "ユーザー詳細";
  }

  return "管理画面";
}

export function getActiveAdminNavigationHref(pathname: string) {
  if (
    pathname === "/admin/attendance" ||
    pathname === "/admin/attendance/new" ||
    /^\/admin\/attendance\/[^/]+(?:\/edit)?$/.test(pathname)
  ) {
    return "/admin/attendance";
  }
  if (
    pathname === "/admin/payroll-estimates" ||
    /^\/admin\/users\/[^/]+\/payroll-estimates$/.test(pathname)
  ) {
    return "/admin/payroll-estimates";
  }
  if (
    pathname === "/admin/users" ||
    /^\/admin\/users\/[^/]+$/.test(pathname) ||
    /^\/admin\/users\/[^/]+\/hourly-wage-rules(?:\/history)?$/.test(pathname)
  ) {
    return "/admin/users";
  }
  return undefined;
}

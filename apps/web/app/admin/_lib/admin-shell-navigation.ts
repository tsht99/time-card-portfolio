export const adminNavigationItems = [
  { href: "/admin/attendance", label: "勤怠" },
  { href: "/admin/payroll", label: "給与" },
  { href: "/admin/users", label: "ユーザー" },
] as const;

const adminPageTitles = new Map<string, string>([
  ["/admin/attendance", "勤怠一覧"],
  ["/admin/attendance/new", "勤怠作成"],
  ["/admin/payroll", "給与一覧"],
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
  if (/^\/admin\/users\/[^/]+\/payroll$/.test(pathname)) {
    return "給与詳細";
  }
  if (/^\/admin\/users\/[^/]+\/hourly-wage-rates\/history$/.test(pathname)) {
    return "時給履歴";
  }
  if (/^\/admin\/users\/[^/]+\/hourly-wage-rates$/.test(pathname)) {
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
    pathname === "/admin/payroll" ||
    /^\/admin\/users\/[^/]+\/payroll$/.test(pathname)
  ) {
    return "/admin/payroll";
  }
  if (
    pathname === "/admin/users" ||
    /^\/admin\/users\/[^/]+$/.test(pathname) ||
    /^\/admin\/users\/[^/]+\/hourly-wage-rates(?:\/history)?$/.test(pathname)
  ) {
    return "/admin/users";
  }
  return undefined;
}

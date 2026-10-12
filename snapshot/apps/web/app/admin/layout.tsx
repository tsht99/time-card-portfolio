import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "TimeCard 管理画面",
  description: "TimeCardの管理画面",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}

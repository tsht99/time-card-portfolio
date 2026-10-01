import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TimeCard",
  description: "勤怠管理システム",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

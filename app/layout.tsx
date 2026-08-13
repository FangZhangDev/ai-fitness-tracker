import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 健身追踪",
  description: "个人长期增肌数据追踪与 AI 分析系统",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}

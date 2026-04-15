import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { initApp } from "@/lib/init";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "诺亚保管库 - 身份认证系统",
  description: "诺亚保管库身份认证系统",
};

// 在服务器端初始化应用（只执行一次）
initApp().catch(console.error);

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

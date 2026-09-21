import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "바로발행 | 네이버 블로그 원고 정리",
  description: "GPT 글 묶음을 글별로 나누고 문단, 목록, 표를 네이버 블로그 붙여넣기용으로 정리합니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}

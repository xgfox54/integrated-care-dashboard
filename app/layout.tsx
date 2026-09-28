import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UsageRoot } from "@/components/usage/usage-root";

export const metadata: Metadata = {
  title: "전국 통합돌봄 사업 총괄 대시보드",
  description:
    "전국 지방자치단체 통합돌봄 사업을 검색하고 비교하는 업무 참고용 대시보드입니다.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 외부 CDN 스크립트(개발용 react-grab · react-scan)는 망분리·보안 기준(제주 디자인 S2)에 맞춰 넣지 않는다.
  return (
    <html lang="ko">
      <body className="flex min-h-svh flex-col antialiased">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <ServiceWorkerRegistrar />
        <UsageRoot />
      </body>
    </html>
  );
}

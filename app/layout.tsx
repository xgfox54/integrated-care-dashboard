import type { Metadata } from "next";
import { ReactDevelopmentTools } from "@/components/react-development-tools";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UsageRoot } from "@/components/usage/usage-root";
import { PageScrollControls } from "@/components/page-scroll-controls";

export const metadata: Metadata = {
  metadataBase: new URL("https://integrated-care-national-dashboard.xgfox54.chatgpt.site"),
  title: "전국 통합돌봄 사업 총괄 대시보드",
  description:
    "전국 지자체의 통합돌봄 사업과 복지제도를 검색·비교하고, 복지통계·예산·업무자료를 한곳에서 확인하세요.",
  openGraph: {
    type: "website",
    url: "/",
    locale: "ko_KR",
    siteName: "전국 통합돌봄 사업 총괄 대시보드",
    title: "전국 통합돌봄 사업 총괄 대시보드",
    description: "전국 지자체의 통합돌봄 사업과 복지제도를 검색·비교하고, 복지통계·예산·업무자료를 한곳에서 확인하세요.",
    images: [{
      url: "/brand/share-dashboard-v2.png",
      width: 1200,
      height: 630,
      type: "image/png",
      alt: "전국 통합돌봄 대시보드 — 통합돌봄 사업·복지제도·통계·예산을 한눈에. 사업 검색·비교, 복지제도100, 복지통계·예산.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "전국 통합돌봄 사업 총괄 대시보드",
    description: "전국 지자체의 통합돌봄 사업과 복지제도를 검색·비교하고, 복지통계·예산·업무자료를 한곳에서 확인하세요.",
    images: ["/brand/share-dashboard-v2.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-care-1c125a41.ico", sizes: "16x16 32x32 48x48" },
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
  return (
    <html lang="ko">
      <body className="flex min-h-svh flex-col antialiased">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <PageScrollControls />
        <ServiceWorkerRegistrar />
        <UsageRoot />
        {process.env.NODE_ENV === "development" && <ReactDevelopmentTools />}
      </body>
    </html>
  );
}

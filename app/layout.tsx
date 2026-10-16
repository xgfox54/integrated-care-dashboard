import type { Metadata } from "next";
import { ReactDevelopmentTools } from "@/components/react-development-tools";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { DataStatusStrip } from "@/components/data-status-strip";
import { UsageRoot } from "@/components/usage/usage-root";
import { PageScrollControls } from "@/components/page-scroll-controls";

export const metadata: Metadata = {
  metadataBase: new URL("https://integrated-care-national-dashboard.xgfox54.chatgpt.site"),
  title: "전국 통합돌봄 사업 총괄 대시보드",
  description:
    "전국 지방자치단체 통합돌봄 사업을 검색하고 비교하는 업무 참고용 대시보드입니다.",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "전국 통합돌봄 사업 총괄 대시보드",
    title: "전국 통합돌봄 사업 총괄 대시보드",
    description: "전국 지방자치단체 통합돌봄 사업을 검색하고 비교하는 업무 참고용 대시보드입니다.",
    images: [{
      url: "/brand/share-care-house-heart-v1.png",
      width: 1200,
      height: 630,
      type: "image/png",
      alt: "통합돌봄 집·하트 로고",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "전국 통합돌봄 사업 총괄 대시보드",
    description: "전국 지방자치단체 통합돌봄 사업을 검색하고 비교하는 업무 참고용 대시보드입니다.",
    images: ["/brand/share-care-house-heart-v1.png"],
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
        <DataStatusStrip />
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

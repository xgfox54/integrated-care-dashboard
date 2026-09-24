import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

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
  const enableDevTools =
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS !== "1";

  return (
    <html lang="ko">
      <head>
        {enableDevTools ? (
          <>
            <Script
              src="https://unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
            <Script
              src="https://unpkg.com/react-scan/dist/auto.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
          </>
        ) : null}
      </head>
      <body className="antialiased">
        <SiteHeader />
        {children}
        <SiteFooter />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

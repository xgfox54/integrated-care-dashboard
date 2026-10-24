import type { Metadata } from "next";

import { InfoExplorer } from "@/components/info/info-explorer";
import { PageUsage } from "@/components/usage/page-usage";

export const metadata: Metadata = {
  title: "시스템 소개 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "통합돌봄·복지제도 검색부터 민원 상담 활용 사례, 데이터베이스 구성과 복지정보 MCP 연결 구조까지 살펴보세요.",
  alternates: { canonical: "/info" },
};

export default function InfoPage() {
  return (
    <main className="mx-auto w-full max-w-(--jeju-main-max-wide) px-4 py-6 sm:px-6">
      <PageUsage page="info" tab="info" />
      <InfoExplorer />
    </main>
  );
}

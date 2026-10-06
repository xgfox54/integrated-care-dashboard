import type { Metadata } from "next";

import { WelfareMindmap } from "@/components/mindmap/welfare-mindmap";
import { PageUsage } from "@/components/usage/page-usage";

export const metadata: Metadata = {
  title: "복지정보 관계성 지도 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "대상자·복지서비스·지역·복지제도·복지예산·복지뉴스가 서로 어떻게 이어지는지 한 단계씩 펼쳐 보며 찾는 관계성 지도입니다.",
};

export default function MindmapPage() {
  return (
    <main className="mx-auto max-w-(--jeju-main-max-wide) px-4 py-6 sm:px-6">
      <WelfareMindmap />
      <PageUsage page="mindmap" tab="mindmap" />
    </main>
  );
}

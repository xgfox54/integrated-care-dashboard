import type { Metadata } from "next";

import { LawBrowser } from "@/components/law/law-browser";
import { PageUsage } from "@/components/usage/page-usage";

export const metadata: Metadata = {
  title: "법령정보 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "법령, 조문, 별표·서식, 판례·결정례와 조례 정비 정보를 국가법령정보 OPEN API에서 직접 조회합니다.",
};

export default function LawPage() {
  return (
    <main className="mx-auto max-w-[1180px] space-y-5 px-4 py-6 sm:px-6">
      <PageUsage page="law" tab="law" />
      <header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <p className="text-(length:--jeju-text-sm) font-extrabold tracking-wide text-primary">법제처 국가법령정보 OPEN API 직접 연계</p>
        <h1 className="mt-1 text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">
          법령정보
        </h1>
        <p className="mt-3 max-w-4xl text-(length:--jeju-text-base) leading-relaxed text-(--jeju-text-body)">
          법령 검색, 시행 시점별 조문, 별표·서식, 판례·해석례·결정례, 법률 리서치와 조례 정비 점검을 한 화면에서 조회합니다.
          별도의 외부 법령 MCP 서버에는 연결하지 않으며, 대시보드에 내장한 korean-law-mcp 실행 구조가 공식 원문 API를 직접 호출합니다.
        </p>
      </header>

      <LawBrowser />

      <aside className="rounded-xl border border-border bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
        <strong className="text-(--jeju-text-strong)">이용 범위:</strong> 이 화면은 업무 참고용이며 법률 자문이나 개인별 권리·의무 판정을 대신하지 않습니다.
        검색 결과에는 개정 전 문서가 함께 나타날 수 있으므로 시행일, 법령 상태, 조문과 별표를 국가법령정보센터 원문에서 최종 확인해야 합니다.
      </aside>
    </main>
  );
}

import type { Metadata } from "next";
import { preload } from "react-dom";

import { BudgetBrowser } from "@/components/budget/budget-browser";
import { FIRST_BUDGET_RESULT_PATH } from "@/components/budget/budget-paths";
import { PageUsage } from "@/components/usage/page-usage";

export const metadata: Metadata = {
  title: "복지예산 집행현황 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "지방재정365에 공개된 세부사업별 예산현액·지출액을 기준일별로 보여 줍니다.",
};

export default function BudgetPage() {
  // 첫 조회(사회복지 전국 1쪽)를 HTML과 함께 내려받기 시작해, 화면 스크립트를 준비하는 동안 기다리는 시간을 겹친다.
  preload(FIRST_BUDGET_RESULT_PATH, { as: "fetch", crossOrigin: "anonymous" });
  return (
    <>
      <BudgetBrowser />
      <PageUsage page="budget" tab="budget" />
    </>
  );
}

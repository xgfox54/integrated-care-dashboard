import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CareBrowser } from "@/components/care/care-browser";
import { CARE_RESOURCES_PUBLIC } from "@/lib/integrations/care-hold";

export const metadata: Metadata = {
  title: "지역 돌봄 자원 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "국민건강보험공단 장기요양기관과 KOSIS 돌봄 수요 통계를 지역별로 보여 줍니다. 통계는 지역 규모 비교용이며 실제 신청자·대상자 수가 아닙니다.",
};

export default function CarePage() {
  // 돌봄자원은 운영자 지시로 비공개·보류 중이다(lib/integrations/care-hold.ts).
  if (!CARE_RESOURCES_PUBLIC) notFound();
  return (
    <main className="mx-auto max-w-(--jeju-main-max-wide) px-4 py-6 sm:px-6">
      <CareBrowser />
    </main>
  );
}

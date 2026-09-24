import type { Metadata } from "next";
import { Suspense } from "react";

import RegistryCatalog from "@/components/welfare100/RegistryCatalog";
import "@/components/welfare100/welfare100.css";
import { HOUSEHOLD_ORDER, LIFECYCLE_ORDER, TOPIC_ORDER } from "@/lib/welfare100/model";

export const metadata: Metadata = {
  title: "복지제도100 | 전국 통합돌봄 사업 총괄 대시보드",
  description:
    "복지로에 등록된 중앙부처·지자체 복지서비스 전체를 복지톡 DB 사업안내 원문과 함께 대상·급여·절차·법령 구조로 정리했습니다.",
};

export default function Welfare100Page() {
  return (
    <main className="k100">
      <Suspense fallback={<div className="explorer-loading">복지제도 대장을 불러오는 중입니다.</div>}>
        <RegistryCatalog categoryOrder={[...TOPIC_ORDER]} lifecycleOrder={[...LIFECYCLE_ORDER]} householdOrder={[...HOUSEHOLD_ORDER]} />
      </Suspense>
    </main>
  );
}


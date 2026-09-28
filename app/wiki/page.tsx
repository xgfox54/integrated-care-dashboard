import type { Metadata } from "next";
import { Suspense } from "react";

import { WikiBrowser } from "@/components/wiki/wiki-browser";

export const metadata: Metadata = {
  title: "통합돌봄 WIKI | 전국 통합돌봄 사업 총괄 대시보드",
  description: "보건복지부 사업별 원자료를 기준으로 작성한 통합돌봄 사업 설명입니다.",
};

export default function WikiPage() {
  return (
    <Suspense
      fallback={(
        <main className="mx-auto max-w-(--jeju-main-max-wide) px-4 py-6 text-(length:--jeju-text-sm) text-muted-foreground sm:px-6">
          통합돌봄 WIKI를 불러오는 중입니다.
        </main>
      )}
    >
      <WikiBrowser />
    </Suspense>
  );
}

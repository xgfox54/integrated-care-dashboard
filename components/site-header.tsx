import { SiteNav } from "@/components/site-nav";
import { VisitCounter } from "@/components/visit-counter";

/** 업무 셸 머리(제주 디자인 GNB). 아래쪽 얇은 3색 선은 제주 브랜드 원색 토큰으로만 그린다. */
export function SiteHeader() {
  return (
    <header className="relative border-b border-(--jeju-shell-border) bg-card print:border-(--jeju-border-strong)">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-0.5 bg-[linear-gradient(90deg,var(--jeju-blue)_0_34%,var(--jeju-green)_34%_67%,var(--jeju-orange)_67%)] print:hidden"
      />
      <div className="mx-auto flex min-h-(--jeju-gnb-h) max-w-(--jeju-main-max-wide) flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col items-start gap-3 md:flex-row md:items-center md:gap-4">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Vinext's next/link runtime prevents navigation in this deployment target. */}
          <a
            href="/"
            className="group flex items-center gap-3 rounded-(--jeju-radius-sm) no-underline outline-none focus-visible:shadow-(--jeju-focus-ring)"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 44px 고정 로고라 이미지 최적화 경로 없이 정적 파일을 바로 쓴다. */}
            <img
              src="/brand/logo-144.png"
              alt=""
              width={44}
              height={44}
              decoding="async"
              className="size-11 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-(length:--jeju-text-lg) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong) transition-colors group-hover:text-primary">
                전국 통합돌봄 사업 총괄 대시보드
              </span>
              <span className="mt-1 block text-(length:--jeju-text-sm) text-muted-foreground">
                전국 지자체 통합돌봄 사업 검색 · 비교 · 사례조사
              </span>
            </span>
          </a>
          <VisitCounter />
        </div>
        <SiteNav />
      </div>
    </header>
  );
}

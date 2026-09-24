import { SiteNav } from "@/components/site-nav";

export function SiteHeader() {
  return (
    <header className="relative border-b border-[#0173bc]/15 bg-white/95 shadow-[0_1px_12px_rgba(1,115,188,0.05)]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-0.5 bg-[linear-gradient(90deg,#0173bc_0_34%,#009f74_34%_67%,#f08101_67%)]"
      />
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-3.5 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Vinext's next/link runtime prevents navigation in this deployment target. */}
          <a
            href="/"
            className="group flex items-center gap-3 focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-[#0173bc]"
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
              <span className="block text-lg font-extrabold tracking-[-0.02em] text-[#07598d] transition-colors group-hover:text-[#0173bc] sm:text-xl">
                전국 통합돌봄 사업 총괄 대시보드
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                전국 지자체 통합돌봄 사업 검색 · 비교 · 사례조사
              </span>
            </span>
          </a>
        </div>
        <SiteNav />
      </div>
    </header>
  );
}

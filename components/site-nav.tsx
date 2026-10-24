"use client";

import { usePathname } from "next/navigation";

import { CARE_RESOURCES_PUBLIC } from "@/lib/integrations/care-hold";
import { markUsageNavigation } from "@/lib/usage/track";
import { cn } from "@/lib/utils";

const NAV_ITEMS: readonly { href: string; label: string }[] = [
  { href: "/info", label: "시스템 소개" },
  { href: "/", label: "대시보드" },
  { href: "/wiki", label: "통합돌봄 WIKI" },
  { href: "/welfare100", label: "복지제도100" },
  { href: "/news", label: "복지뉴스" },
  { href: "/budget", label: "복지예산" },
  { href: "/statistics", label: "복지통계" },
  { href: "/welfaremcp", label: "복지정보MCP" },
  { href: "/sources", label: "데이터 출처" },
  // 돌봄자원은 보류 중이라 메뉴에 내지 않는다(lib/integrations/care-hold.ts).
  ...(CARE_RESOURCES_PUBLIC ? [{ href: "/care", label: "돌봄자원" }] : []),
];

// 공개된 일반 메뉴 순서대로 반복한다. 데이터 출처는 순환에서 빼고 항상 빨강을 쓴다.
const NAV_DOT_COLORS = ["bg-(--jeju-orange)", "bg-(--jeju-green)", "bg-(--jeju-blue)"] as const;
const NAV_ITEMS_WITH_DOTS = NAV_ITEMS.map((item, index, items) => ({
  ...item,
  dot: item.href === "/sources"
    ? "bg-(--jeju-danger)"
    : NAV_DOT_COLORS[items.slice(0, index).filter((previous) => previous.href !== "/sources").length % NAV_DOT_COLORS.length],
}));
const MOBILE_NAV_CELL_COUNT = 9;
const NAV_GRID_CELLS: readonly ((typeof NAV_ITEMS_WITH_DOTS)[number] | null)[] = Array.from(
  { length: Math.max(MOBILE_NAV_CELL_COUNT, NAV_ITEMS_WITH_DOTS.length) },
  (_, index) => NAV_ITEMS_WITH_DOTS[index] ?? null,
);

/** 지금 보고 있는 화면의 메뉴인지. 복지제도 상세(/welfare100/…)도 복지제도100으로 본다. */
function isCurrentPage(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

export function SiteNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="주요 메뉴" className="w-full print:hidden">
      <ul className="grid w-full grid-cols-3 gap-x-1 gap-y-1 md:flex md:flex-nowrap md:items-center md:gap-1">
        {NAV_GRID_CELLS.map((item, index) => {
          if (!item) {
            return (
              <li
                key={"empty-cell-" + index}
                aria-hidden="true"
                className="min-h-(--jeju-control-h) min-w-0 bg-transparent md:hidden"
              />
            );
          }
          const current = isCurrentPage(pathname, item.href);
          return (
            <li key={item.href} className="flex min-w-0 items-center justify-start bg-transparent md:shrink-0">
              <a
                href={item.href}
                aria-current={current ? "page" : undefined}
                onClick={() => markUsageNavigation(item.href, current)}
                className={cn(
                  "inline-flex min-h-(--jeju-control-h) max-w-full items-center justify-start rounded-(--jeju-radius) px-2.5 text-left text-(length:--jeju-text-base) font-bold whitespace-nowrap no-underline outline-none transition-colors focus-visible:shadow-(--jeju-focus-ring) max-[360px]:px-1 max-[360px]:text-(length:--jeju-text-xs) sm:px-3 md:px-1 md:text-(length:--jeju-text-xs) lg:px-2 lg:text-(length:--jeju-text-base) xl:px-3",
                  // 현재 화면은 초록으로 채워 한눈에 구분한다. 흰 글자와 대비 4.5:1을 넘는 제주 접근성 초록(--jeju-secondary-strong)을 쓴다.
                  current
                    ? "bg-(--jeju-secondary-strong) text-(--jeju-on-fill) forced-colors:border forced-colors:border-[CanvasText]"
                    : "text-(--jeju-text-body) hover:bg-(--jeju-primary-tint) hover:text-primary",
                )}
              >
                <span
                  className={cn("mr-1.5 size-1.5 shrink-0 rounded-full max-[360px]:mr-1 max-[360px]:size-1", current ? "bg-(--jeju-on-fill)" : item.dot)}
                  aria-hidden="true"
                />
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
